#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"
require_arm64_macos

worker_build_root="${SHORT_EDITOR_WORKER_BUILD:-${release_repo_root}/build/worker}"
worker_venv="${worker_build_root}/venv"
worker_dist="${worker_build_root}/dist"
worker_output="${release_repo_root}/resources/worker/short-editor-worker"

export UV_CACHE_DIR="${release_repo_root}/build/uv-cache"
export UV_PYTHON_INSTALL_DIR="${release_repo_root}/build/uv-python"
rm -rf "${worker_venv}" "${worker_dist}" "${worker_build_root}/work"
mkdir -p "${worker_build_root}"
uv python install 3.12
uv venv --python 3.12 --seed "${worker_venv}"
uv pip sync --python "${worker_venv}/bin/python" \
  "${release_repo_root}/resources/worker/requirements.lock"

export SOURCE_DATE_EPOCH="1781653653"
export PYTHONHASHSEED="0"
"${worker_venv}/bin/pyinstaller" \
  --clean \
  --noconfirm \
  --onefile \
  --name short-editor-worker \
  --distpath "${worker_dist}" \
  --workpath "${worker_build_root}/work" \
  --specpath "${worker_build_root}" \
  --target-architecture arm64 \
  --osx-bundle-identifier com.lexcorp.shorteditor.worker \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  "${release_repo_root}/resources/worker/worker.py"

install -m 0755 "${worker_dist}/short-editor-worker" "${worker_output}"
env -i \
  SHORT_EDITOR_WHISPER_MODEL_DIR="${worker_build_root}/missing-models" \
  SHORT_EDITOR_FFMPEG_PATH="${release_repo_root}/resources/bin/ffmpeg" \
  "$(command -v node)" "${script_dir}/smoke-worker.mjs" "${worker_output}"
reject_nonredistributable_paths "${worker_output}"
echo "Built frozen Python 3.12 arm64 worker."
