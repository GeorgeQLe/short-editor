#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"

export UV_CACHE_DIR="${release_repo_root}/build/uv-cache"
export UV_PYTHON_INSTALL_DIR="${release_repo_root}/build/uv-python"
uv pip compile \
  --python-version 3.12 \
  --python-platform aarch64-apple-darwin \
  --generate-hashes \
  --no-emit-index-url \
  --output-file "${release_repo_root}/resources/worker/requirements.lock" \
  "${release_repo_root}/resources/worker/requirements.in"

grep -q 'faster-whisper==1.2.1' "${release_repo_root}/resources/worker/requirements.lock"
grep -q 'ctranslate2==4.8.1' "${release_repo_root}/resources/worker/requirements.lock"
grep -q 'pyinstaller==6.21.0' "${release_repo_root}/resources/worker/requirements.lock"
if grep -E '^[a-zA-Z0-9_.-]+(@|[<>~!])' \
  "${release_repo_root}/resources/worker/requirements.lock" | grep -q .; then
  echo "Worker lock contains an unpinned requirement." >&2
  exit 1
fi
package_count="$(grep -Ec '^[a-zA-Z0-9_.-]+==' \
  "${release_repo_root}/resources/worker/requirements.lock")"
hash_block_count="$(grep -Ec '^[[:space:]]+--hash=sha256:' \
  "${release_repo_root}/resources/worker/requirements.lock")"
if [[ "${package_count}" -eq 0 ]] || [[ "${hash_block_count}" -lt "${package_count}" ]]; then
  echo "Worker lock does not hash every pinned package." >&2
  exit 1
fi
