"""Deterministic faster-whisper test double. It performs no network access."""

import os
from pathlib import Path
import time
from types import SimpleNamespace


def word(text, start, end, probability):
    return SimpleNamespace(word=text, start=start, end=end, probability=probability)


def segment(text, start, end, words, avg_logprob=-0.1):
    return SimpleNamespace(
        text=text,
        start=start,
        end=end,
        words=words,
        avg_logprob=avg_logprob,
    )


class WhisperModel:
    def __init__(self, model_path, local_files_only=False, **_options):
        if not local_files_only:
            raise RuntimeError("test provider forbids network-capable loading")
        if not (Path(model_path) / "model.bin").is_file():
            raise RuntimeError("model missing")

    def transcribe(self, source_path, language, word_timestamps, vad_filter):
        if language != "en" or not vad_filter:
            raise RuntimeError("unexpected options")
        mode = Path(source_path).stem
        info = SimpleNamespace(duration=4.0)

        def generated():
            if mode == "unsupported":
                raise RuntimeError("unsupported audio")
            if mode == "silence":
                return
            if mode == "slow":
                for index in range(40):
                    time.sleep(0.025)
                    start = index * 0.1
                    yield segment(
                        " waiting ",
                        start,
                        start + 0.1,
                        [word(" waiting ", start, start + 0.1, 0.9)],
                    )
                return
            yield segment(
                " Hello world. ",
                0.0,
                2.0,
                [
                    word(" Hello", -0.1, 0.8, 0.95),
                    word(" world.", 0.7, 2.1, 0.85),
                ] if word_timestamps else [],
            )
            yield segment(
                " Second thought. ",
                1.9,
                4.0,
                [word(" Second", 1.9, 2.8, 0.8), word(" thought.", 2.8, 4.0, 0.75)]
                if word_timestamps
                else [],
                avg_logprob=-0.2,
            )

        return generated(), info
