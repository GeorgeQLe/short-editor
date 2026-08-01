#!/bin/bash

# Every external release input is immutable and checksum-pinned here. Keep this
# file in sync with docs/release-sources.md and resources/runtime-manifest.json.

FFMPEG_VERSION="8.1.2"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz"
FFMPEG_SHA256="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

WINDOWS_FFMPEG_VERSION="8.1.2"
WINDOWS_FFMPEG_URL="https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip"
WINDOWS_FFMPEG_SHA256="db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"

X264_REVISION="b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
X264_VERSION="r3222"
X264_URL="https://code.videolan.org/videolan/x264/-/archive/${X264_REVISION}/x264-${X264_REVISION}.tar.gz"
X264_SHA256="cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9"

FREETYPE_VERSION="2.14.1"
FREETYPE_URL="https://downloads.sourceforge.net/freetype/freetype-2.14.1.tar.xz"
FREETYPE_SHA256="32427e8c471ac095853212a37aef816c60b42052d4d9e48230bab3bdf2936ccc"

HARFBUZZ_VERSION="14.2.1"
HARFBUZZ_URL="https://github.com/harfbuzz/harfbuzz/releases/download/14.2.1/harfbuzz-14.2.1.tar.xz"
HARFBUZZ_SHA256="a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e"

MODEL_ID="small.en"
MODEL_REPOSITORY="Systran/faster-whisper-small.en"
MODEL_REVISION="e0e3c0a16c844a994ca4d6d1318ce35f68236052"
MODEL_RELEASE_TAG="model-small.en-e0e3c0a"
MODEL_ARCHIVE_NAME="faster-whisper-small.en-e0e3c0a.tar.gz"
MODEL_MANIFEST_NAME="faster-whisper-small.en-e0e3c0a.manifest.json"
