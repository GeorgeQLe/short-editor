#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"

"${script_dir}/build-ffmpeg-macos-arm64.sh"
"${script_dir}/build-worker-macos-arm64.sh"
"${script_dir}/fetch-and-package-model.sh"
node "${script_dir}/package-corresponding-source.mjs"
node "${script_dir}/generate-runtime-manifest.mjs"

echo "All redistributable macOS release inputs are staged and validated."
