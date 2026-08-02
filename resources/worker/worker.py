#!/usr/bin/env python3
"""SiftCut v1 local provider worker.

The worker never opens application storage and never downloads a model. Local
faster-whisper models are resolved to an existing directory before the provider
is invoked with ``local_files_only=True``.
"""

import importlib.metadata
import ipaddress
import json
import math
import os
from pathlib import Path
import shutil
from socket import timeout as SocketTimeout
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import (
    HTTPRedirectHandler,
    Request,
    build_opener,
)

PROTOCOL_VERSION = "v1"
WORKER_VERSION = "0.3.0"
DEFAULT_MODEL_IDS = ("small.en",)
active_jobs = {}
active_lock = threading.Lock()
send_lock = threading.Lock()
running = True


def send(message):
    with send_lock:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def configured_model_ids():
    configured = os.environ.get("SHORT_EDITOR_WHISPER_MODEL_IDS", "")
    values = [value.strip() for value in configured.split(",") if value.strip()]
    return tuple(dict.fromkeys(values or DEFAULT_MODEL_IDS))


def model_roots():
    configured = os.environ.get("SHORT_EDITOR_WHISPER_MODEL_DIR")
    if configured:
        return (Path(configured).expanduser(),)
    cache = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if cache:
        return (Path(cache).expanduser(),)
    home = os.environ.get("HF_HOME")
    if home:
        return (Path(home).expanduser() / "hub",)
    return (Path.home() / ".cache" / "huggingface" / "hub",)


def is_model_directory(path):
    return path.is_dir() and (path / "model.bin").is_file()


def resolve_model_path(model_id):
    identifier = Path(model_id)
    if identifier.is_absolute() or ".." in identifier.parts or "\\" in model_id:
        return None
    cache_name = "models--" + model_id.replace("/", "--")
    aliases = (
        model_id,
        "faster-whisper-" + model_id,
        cache_name,
        "models--Systran--faster-whisper-" + model_id,
    )
    for root in model_roots():
        for alias in aliases:
            candidate = root / alias
            if is_model_directory(candidate):
                return candidate
            snapshots = candidate / "snapshots"
            if snapshots.is_dir():
                for snapshot in sorted(snapshots.iterdir(), reverse=True):
                    if is_model_directory(snapshot):
                        return snapshot
    return None


def faster_whisper_state():
    try:
        from faster_whisper import WhisperModel  # noqa: F401
        try:
            version = importlib.metadata.version("faster-whisper")
        except importlib.metadata.PackageNotFoundError:
            version = "development"
        return True, version
    except (ImportError, OSError):
        return False, None


def dependencies():
    available, version = faster_whisper_state()
    values = [
        {
            "id": "faster-whisper",
            "state": "available" if available else "missing",
            "version": version,
            "detail": None if available else "Install the local faster-whisper worker dependency",
        }
    ]
    for model_id in configured_model_ids():
        installed = resolve_model_path(model_id) is not None
        values.append(
            {
                "id": "faster-whisper:model:" + model_id,
                "state": "available" if installed else "missing",
                "version": None,
                "detail": None if installed else "Install this model in the configured local model directory",
            }
        )
    ffmpeg = shutil.which(os.environ.get("SHORT_EDITOR_FFMPEG_PATH", "ffmpeg"))
    values.append(
        {
            "id": "ffmpeg:visual-sampling",
            "state": "available" if ffmpeg else "missing",
            "version": ffmpeg_version(ffmpeg) if ffmpeg else None,
            "detail": None if ffmpeg else "Install FFmpeg or configure SHORT_EDITOR_FFMPEG_PATH",
        }
    )
    values.append(
        {
            "id": "ollama:http-api",
            "state": "available",
            "version": "v1",
            "detail": "Availability of the configured Ollama endpoint is checked per operation",
        }
    )
    return values


def status():
    current_dependencies = dependencies()
    ready = all(
        item["state"] == "available"
        for item in current_dependencies
        if item["id"] != "ollama:http-api"
    )
    with active_lock:
        job_ids = sorted(active_jobs)
    return {
        "state": "ready" if ready else "degraded",
        "activeJobIds": job_ids,
        "dependencies": current_dependencies,
    }


def capabilities():
    package_available, _ = faster_whisper_state()
    model_available = any(resolve_model_path(model_id) for model_id in configured_model_ids())
    transcription_available = package_available and model_available
    visual_available = shutil.which(os.environ.get("SHORT_EDITOR_FFMPEG_PATH", "ffmpeg")) is not None
    return [
        {
            "operation": "transcription",
            "available": transcription_available,
            "providers": ["faster-whisper"] if transcription_available else [],
            "features": ["english", "segments", "word-timestamps", "no-diarization"]
            if transcription_available
            else [],
        },
        {
            "operation": "diarization",
            "available": False,
            "providers": [],
            "features": ["explicit-unsupported"],
        },
        {
            "operation": "visual_sampling",
            "available": visual_available,
            "providers": ["ffmpeg"] if visual_available else [],
            "features": [
                "activity",
                "explicit-unsupported-speaker-framing",
                "explicit-unsupported-face-detection",
                "explicit-unsupported-screen-share",
            ] if visual_available else [],
        },
        {
            "operation": "provider_call",
            "available": True,
            "providers": ["ollama"],
            "features": ["structured-output", "redirect-policy", "no-fallback"],
        },
    ]


def ffmpeg_version(executable):
    if not executable:
        return None
    try:
        completed = subprocess.run(
            [executable, "-version"],
            capture_output=True,
            check=False,
            timeout=3,
        )
        first_line = completed.stdout.decode("utf-8", errors="replace").splitlines()[0]
        parts = first_line.split()
        return parts[2] if len(parts) > 2 else "installed"
    except (OSError, subprocess.SubprocessError, IndexError):
        return "installed"


def heartbeat():
    sequence = 0
    while running:
        send(
            {
                "protocolVersion": PROTOCOL_VERSION,
                "type": "heartbeat",
                "sequence": sequence,
                "sentAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        sequence += 1
        time.sleep(2)


def error(request_id, job_id, code, message, retryable):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "error",
            "requestId": request_id,
            "jobId": job_id,
            "code": code,
            "message": message,
            "retryable": retryable,
        }
    )


def progress(job_id, value, stage):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.progress",
            "jobId": job_id,
            "progress": max(0.0, min(1.0, value)),
            "stage": stage,
        }
    )


def milliseconds(value):
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("Non-finite timestamp")
    return max(0, round(numeric * 1000))


def confidence_from_log_probability(value):
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric):
        return None
    return max(0.0, min(1.0, math.exp(numeric)))


def normalize_word(word, segment_start, segment_end, prior_end):
    text = str(getattr(word, "word", "")).strip()
    start = max(segment_start, milliseconds(getattr(word, "start")))
    end = min(segment_end, milliseconds(getattr(word, "end")))
    start = max(start, prior_end)
    if not text or end <= start:
        return None
    probability = getattr(word, "probability", None)
    confidence = None if probability is None else max(0.0, min(1.0, float(probability)))
    return {
        "startMs": start,
        "endMs": end,
        "text": text,
        "confidence": confidence,
    }


def transcribe(job_id, request_id, job, cancelled):
    model_id = job["modelId"]
    model_path = resolve_model_path(model_id)
    if model_path is None:
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The selected faster-whisper model is not installed locally",
            False,
        )
        return
    try:
        from faster_whisper import WhisperModel
    except (ImportError, OSError):
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The faster-whisper worker dependency is not installed",
            False,
        )
        return

    progress(job_id, 0.02, "loading local transcription model")
    try:
        model = WhisperModel(
            str(model_path),
            device=os.environ.get("SHORT_EDITOR_WHISPER_DEVICE", "auto"),
            compute_type=os.environ.get("SHORT_EDITOR_WHISPER_COMPUTE_TYPE", "default"),
            local_files_only=True,
        )
    except Exception:
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The selected faster-whisper model could not be loaded locally",
            False,
        )
        return
    if cancelled.is_set():
        send_cancelled(job_id)
        return

    progress(job_id, 0.08, "decoding local audio")
    try:
        generated, info = model.transcribe(
            job["sourcePath"],
            language="en",
            word_timestamps=job["wordTimestamps"],
            vad_filter=True,
        )
        duration = float(getattr(info, "duration", 0) or 0)
        segments = []
        words = []
        prior_segment_end = 0
        for raw_segment in generated:
            if cancelled.is_set():
                send_cancelled(job_id)
                return
            text = str(getattr(raw_segment, "text", "")).strip()
            start = max(prior_segment_end, milliseconds(getattr(raw_segment, "start")))
            end = milliseconds(getattr(raw_segment, "end"))
            if not text or end <= start:
                continue
            segment = {
                "startMs": start,
                "endMs": end,
                "text": text,
                "confidence": confidence_from_log_probability(
                    getattr(raw_segment, "avg_logprob", None)
                ),
            }
            segments.append(segment)
            prior_segment_end = end
            prior_word_end = start
            if job["wordTimestamps"]:
                for raw_word in getattr(raw_segment, "words", None) or ():
                    word = normalize_word(raw_word, start, end, prior_word_end)
                    if word is not None:
                        words.append(word)
                        prior_word_end = word["endMs"]
            if duration > 0:
                progress(job_id, 0.08 + 0.84 * min(1.0, end / (duration * 1000)), "decoding local audio")
    except Exception:
        error(
            request_id,
            job_id,
            "PROVIDER_OUTPUT_INVALID",
            "The local transcription provider could not decode this source",
            False,
        )
        return

    if cancelled.is_set():
        send_cancelled(job_id)
        return
    progress(job_id, 0.96, "normalizing transcript timing")
    _, provider_version = faster_whisper_state()
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.result",
            "jobId": job_id,
            "result": {
                "kind": "transcription",
                "language": "en",
                "segments": segments,
                "words": words if job["wordTimestamps"] else None,
                "diarization": "absent",
                "provenance": {
                    "provider": "faster-whisper",
                    "providerClass": "local",
                    "modelId": model_id,
                    "providerVersion": provider_version or "unknown",
                    "optionsVersion": "transcription-v1",
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            },
        }
    )


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def visual_fixture(job):
    fixture_id = job.get("fixtureId")
    root = os.environ.get("SHORT_EDITOR_VISUAL_FIXTURE_DIR")
    if not fixture_id or not root:
        return None
    if not all(character.isalnum() or character in "_-" for character in fixture_id):
        return None
    path = Path(root) / (fixture_id + ".json")
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def pgm_frames(data):
    offset = 0
    while offset < len(data):
        if data[offset : offset + 2] != b"P5":
            raise ValueError("Invalid FFmpeg sampling frame")
        offset += 2
        tokens = []
        while len(tokens) < 3:
            while offset < len(data) and data[offset] in b" \t\r\n":
                offset += 1
            if offset < len(data) and data[offset] == 35:
                while offset < len(data) and data[offset] != 10:
                    offset += 1
                continue
            end = offset
            while end < len(data) and data[end] not in b" \t\r\n":
                end += 1
            tokens.append(int(data[offset:end]))
            offset = end
        width, height, maximum = tokens
        if width <= 0 or height <= 0 or maximum != 255:
            raise ValueError("Unsupported FFmpeg sampling frame")
        if offset >= len(data) or data[offset] not in b" \t\r\n":
            raise ValueError("Invalid FFmpeg sampling frame header")
        offset += 1
        length = width * height
        pixels = data[offset : offset + length]
        if len(pixels) != length:
            raise ValueError("Truncated FFmpeg sampling frame")
        offset += length
        yield pixels


def visual_sampling(job_id, request_id, job, cancelled):
    fixture = visual_fixture(job)
    if fixture is not None:
        progress(job_id, 0.5, "sampling local visual fixture")
        if cancelled.is_set():
            send_cancelled(job_id)
            return
        result = fixture
        result["kind"] = "visual_sampling"
        result["provenance"] = {
            "provider": "visual-fixture",
            "providerClass": "local",
            "modelId": "fixture",
            "providerVersion": "1",
            "optionsVersion": "visual-sampling-v1",
            "createdAt": utc_now(),
        }
        send({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.result",
            "jobId": job_id,
            "result": result,
        })
        return

    executable = shutil.which(os.environ.get("SHORT_EDITOR_FFMPEG_PATH", "ffmpeg"))
    if not executable:
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "FFmpeg is required for local visual sampling",
            False,
        )
        return
    interval_seconds = job["intervalMs"] / 1000.0
    maximum_samples = job["maximumSamples"]
    command = [
        executable,
        "-nostdin",
        "-v",
        "error",
        "-i",
        job["sourcePath"],
        "-vf",
        "fps=1/{:.6f},scale=160:-2,format=gray".format(interval_seconds),
        "-frames:v",
        str(maximum_samples),
        "-f",
        "image2pipe",
        "-vcodec",
        "pgm",
        "pipe:1",
    ]
    progress(job_id, 0.05, "sampling local video frames")
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        while True:
            try:
                stdout, _ = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                if not cancelled.is_set():
                    continue
                process.terminate()
                try:
                    process.communicate(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                send_cancelled(job_id)
                return
        if process.returncode != 0:
            raise ValueError("FFmpeg could not sample the source")
        samples = []
        previous = None
        for index, pixels in enumerate(pgm_frames(stdout)):
            if cancelled.is_set():
                send_cancelled(job_id)
                return
            activity = 0.0
            if previous is not None and len(previous) == len(pixels):
                activity = sum(abs(left - right) for left, right in zip(previous, pixels))
                activity = max(0.0, min(1.0, activity / (len(pixels) * 255.0) * 4.0))
            samples.append({
                "atMs": index * job["intervalMs"],
                "activity": round(activity, 6),
                "speakerFraming": None,
                "faceCount": None,
                "screenShare": None,
            })
            previous = pixels
            progress(
                job_id,
                0.1 + 0.8 * min(1.0, (index + 1) / maximum_samples),
                "measuring local visual activity",
            )
    except (OSError, subprocess.SubprocessError, ValueError):
        error(
            request_id,
            job_id,
            "PROVIDER_OUTPUT_INVALID",
            "Local visual sampling could not decode this source",
            False,
        )
        return
    send({
        "protocolVersion": PROTOCOL_VERSION,
        "type": "job.result",
        "jobId": job_id,
        "result": {
            "kind": "visual_sampling",
            "capabilities": {
                "activity": "supported",
                "speakerFraming": "unsupported",
                "faceDetection": "unsupported",
                "screenShareDetection": "unsupported",
            },
            "samples": samples,
            "provenance": {
                "provider": "ffmpeg",
                "providerClass": "local",
                "modelId": "frame-difference",
                "providerVersion": ffmpeg_version(executable) or "installed",
                "optionsVersion": "visual-sampling-v1",
                "createdAt": utc_now(),
            },
        },
    })


CLASS_RANK = {"local": 0, "network": 1, "cloud": 2}


def endpoint_class(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        raise ValueError("Unsupported Ollama endpoint")
    hostname = (parsed.hostname or "").lower()
    if hostname == "localhost":
        return "local"
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return "cloud"
    if getattr(address, "ipv4_mapped", None):
        address = address.ipv4_mapped
    if address.is_loopback:
        return "local"
    if address.is_private or address.is_link_local:
        return "network"
    return "cloud"


def authorize_endpoint(url, options):
    classification = endpoint_class(url)
    maximum = options.get("maximumEndpointClass")
    if maximum not in CLASS_RANK:
        raise PermissionError("Missing endpoint policy")
    effective = classification
    if CLASS_RANK[maximum] > CLASS_RANK[effective]:
        effective = maximum
    if effective == "network" and not options.get("networkConsent"):
        raise PermissionError("Private-LAN Ollama use requires network disclosure")
    if effective == "cloud" and not options.get("cloudConsent"):
        raise PermissionError("Public Ollama use requires cloud authorization")
    return classification


def effective_endpoint_class(url, options):
    classification = endpoint_class(url)
    maximum = options.get("maximumEndpointClass", classification)
    return maximum if CLASS_RANK.get(maximum, -1) > CLASS_RANK[classification] else classification


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def ollama_discover(base_url, options):
    current = base_url.rstrip("/")
    opener = build_opener(NoRedirect)
    for _ in range(6):
        authorize_endpoint(current, options)
        request = Request(current + "/api/version", method="GET")
        try:
            response = opener.open(request, timeout=options["timeoutMs"] / 1000.0)
            payload = json.loads(response.read(64 * 1024))
            version = payload.get("version")
            if not isinstance(version, str) or not version:
                raise ValueError("Invalid Ollama version response")
            return current, version
        except HTTPError as http_error:
            if http_error.code not in (301, 302, 303, 307, 308):
                raise
            location = http_error.headers.get("Location")
            if not location:
                raise ValueError("Ollama redirect is missing a target")
            target = urljoin(current + "/api/version", location)
            parsed = urlparse(target)
            suffix = parsed.path
            if suffix.endswith("/api/version"):
                suffix = suffix[: -len("/api/version")]
            current = parsed._replace(path=suffix.rstrip("/"), query="", fragment="").geturl()
            authorize_endpoint(current, options)
    raise ValueError("Too many Ollama redirects")


def read_analysis_inputs(paths):
    values = []
    total = 0
    for raw_path in paths:
        path = Path(raw_path)
        size = path.stat().st_size
        total += size
        if total > 4 * 1024 * 1024:
            raise ValueError("Analysis inputs exceed the local worker limit")
        values.append(json.loads(path.read_text(encoding="utf-8")))
    return values


def ollama_provider_call(job_id, request_id, job, cancelled):
    if job.get("provider") != "ollama" or job.get("operation") not in ("analysis", "capabilities"):
        error(request_id, job_id, "DEPENDENCY_UNAVAILABLE", "Unsupported local provider call", False)
        return
    options = job.get("options") or {}
    try:
        progress(job_id, 0.05, "checking Ollama endpoint policy")
        base_url, provider_version = ollama_discover(options["baseUrl"], options)
        if cancelled.is_set():
            send_cancelled(job_id)
            return
        if job.get("operation") == "capabilities":
            request = Request(base_url.rstrip("/") + "/api/tags", method="GET")
            response = build_opener(NoRedirect).open(
                request,
                timeout=options["timeoutMs"] / 1000.0,
            )
            payload = json.loads(response.read(4 * 1024 * 1024))
            models = []
            for model in payload.get("models", []):
                details = model.get("details") or {}
                model_id = model.get("model") or model.get("name")
                if not isinstance(model_id, str) or not model_id:
                    raise ValueError("Invalid Ollama model inventory")
                size = model.get("size")
                models.append({
                    "modelId": model_id,
                    "size": size if isinstance(size, int) and size >= 0 else None,
                    "family": details.get("family") if isinstance(details.get("family"), str) else None,
                })
            output = {"models": models}
            raise StopIteration
        inputs = read_analysis_inputs(job.get("inputArtifactPaths") or [])
        prompt = (
            "Analyze the transcript and visual samples for short-form video highlights. "
            "Use only provided evidence, millisecond timing, and return JSON matching the schema. "
            "Input artifacts:\n" + json.dumps(inputs, separators=(",", ":"))
        )
        body = json.dumps({
            "model": job["modelId"],
            "prompt": prompt,
            "stream": False,
            "format": options["outputSchema"],
            "options": {"temperature": options.get("temperature", 0)},
        }, separators=(",", ":")).encode("utf-8")
        authorize_endpoint(base_url, options)
        progress(job_id, 0.2, "running schema-constrained Ollama analysis")
        request = Request(
            base_url.rstrip("/") + "/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        response = build_opener(NoRedirect).open(
            request,
            timeout=options["timeoutMs"] / 1000.0,
        )
        response_body = response.read(8 * 1024 * 1024 + 1)
        if len(response_body) > 8 * 1024 * 1024:
            raise ValueError("Ollama response exceeds the worker limit")
        envelope = json.loads(response_body)
        raw_output = envelope.get("response")
        if not isinstance(raw_output, str):
            raise ValueError("Ollama response is missing structured output")
        output = json.loads(raw_output)
        if not isinstance(output, dict):
            raise ValueError("Ollama structured output must be an object")
    except StopIteration:
        pass
    except PermissionError as policy_error:
        error(request_id, job_id, "PROVIDER_UNAVAILABLE", str(policy_error), False)
        return
    except (HTTPError, URLError, TimeoutError, SocketTimeout):
        error(request_id, job_id, "PROVIDER_UNAVAILABLE", "The configured Ollama endpoint is unavailable", True)
        return
    except (KeyError, OSError, ValueError, TypeError):
        error(request_id, job_id, "PROVIDER_OUTPUT_INVALID", "Ollama returned invalid structured analysis output", False)
        return
    if cancelled.is_set():
        send_cancelled(job_id)
        return
    send({
        "protocolVersion": PROTOCOL_VERSION,
        "type": "job.result",
        "jobId": job_id,
        "result": {
            "kind": "provider_call",
            "schemaVersion": job["schemaVersion"],
            "output": output,
            "provenance": {
                "provider": "ollama",
                "providerClass": effective_endpoint_class(base_url, options),
                "modelId": job["modelId"],
                "providerVersion": provider_version,
                "optionsVersion": options["promptVersion"] + "+" + job["schemaVersion"],
                "createdAt": utc_now(),
            },
        },
    })


def send_cancelled(job_id):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.cancelled",
            "jobId": job_id,
        }
    )


def run_job(job_id, request_id, job, cancelled):
    try:
        if job.get("kind") == "transcription":
            transcribe(job_id, request_id, job, cancelled)
        elif job.get("kind") == "visual_sampling":
            visual_sampling(job_id, request_id, job, cancelled)
        elif job.get("kind") == "provider_call":
            ollama_provider_call(job_id, request_id, job, cancelled)
        else:
            error(
                request_id,
                job_id,
                "DEPENDENCY_UNAVAILABLE",
                "The requested provider capability is not installed",
                False,
            )
    finally:
        with active_lock:
            active_jobs.pop(job_id, None)


def start_job(message):
    job_id = message.get("jobId")
    job = message.get("job") or {}
    if not isinstance(job_id, str) or not job_id:
        error(message.get("requestId"), None, "PROVIDER_OUTPUT_INVALID", "Invalid job identifier", False)
        return
    with active_lock:
        if job_id in active_jobs:
            error(message.get("requestId"), job_id, "PROVIDER_OUTPUT_INVALID", "Duplicate job", False)
            return
        cancelled = threading.Event()
        active_jobs[job_id] = cancelled
    threading.Thread(
        target=run_job,
        args=(job_id, message.get("requestId"), job, cancelled),
        daemon=True,
    ).start()


def cancel_job(job_id):
    with active_lock:
        cancelled = active_jobs.get(job_id)
    if cancelled is None:
        send_cancelled(job_id)
    else:
        cancelled.set()


def main():
    global running
    threading.Thread(target=heartbeat, daemon=True).start()
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except (TypeError, ValueError):
            error(None, None, "PROVIDER_OUTPUT_INVALID", "Malformed command", False)
            continue
        request_id = message.get("requestId")
        if message.get("protocolVersion") != PROTOCOL_VERSION:
            error(request_id, message.get("jobId"), "PROVIDER_OUTPUT_INVALID", "Protocol version mismatch", False)
            continue
        message_type = message.get("type")
        if message_type == "hello":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "ready",
                    "requestId": request_id,
                    "workerVersion": WORKER_VERSION,
                    "capabilities": capabilities(),
                    "status": status(),
                }
            )
        elif message_type == "capabilities.get":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "capabilities",
                    "requestId": request_id,
                    "capabilities": capabilities(),
                }
            )
        elif message_type == "status.get":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "status",
                    "requestId": request_id,
                    "status": status(),
                }
            )
        elif message_type == "job.start":
            start_job(message)
        elif message_type == "job.cancel":
            cancel_job(message.get("jobId"))
        elif message_type == "shutdown":
            with active_lock:
                for cancelled in active_jobs.values():
                    cancelled.set()
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "shutdown.complete",
                    "requestId": request_id,
                }
            )
            running = False
            return
        else:
            error(request_id, message.get("jobId"), "PROVIDER_OUTPUT_INVALID", "Unknown command", False)


if __name__ == "__main__":
    main()
