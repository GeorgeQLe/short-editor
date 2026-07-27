#!/usr/bin/env python3
"""Short Editor v1 worker host.

This host deliberately contains no provider or SQLite implementation. It proves
the packaged/development lifecycle and reports dependency/capability state until
provider tasks add concrete handlers.
"""

import json
import sys
import threading
import time

PROTOCOL_VERSION = "v1"
WORKER_VERSION = "0.1.0"
active_jobs = set()
running = True


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def status():
    return {
        "state": "degraded",
        "activeJobIds": sorted(active_jobs),
        "dependencies": [
            {
                "id": "provider-handlers",
                "state": "missing",
                "version": None,
                "detail": "Provider tasks PRO-02, PRO-03, and PRO-05 are not installed",
            }
        ],
    }


def capabilities():
    return [
        {
            "operation": operation,
            "available": False,
            "providers": [],
            "features": [],
        }
        for operation in (
            "transcription",
            "diarization",
            "visual_sampling",
            "provider_call",
        )
    ]


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
            error(
                request_id,
                message.get("jobId"),
                "DEPENDENCY_UNAVAILABLE",
                "The requested provider capability is not installed",
                True,
            )
        elif message_type == "job.cancel":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "job.cancelled",
                    "jobId": message.get("jobId"),
                }
            )
        elif message_type == "shutdown":
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
