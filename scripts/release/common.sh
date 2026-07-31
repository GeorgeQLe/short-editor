#!/bin/bash

set -euo pipefail

release_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
release_repo_root="$(cd "${release_script_dir}/../.." && pwd)"

# shellcheck source=release-config.sh
source "${release_script_dir}/release-config.sh"

release_jobs() {
  sysctl -n hw.logicalcpu 2>/dev/null || echo 4
}
sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

download_verified() {
  local source_url="$1"
  local expected_sha="$2"
  local destination="$3"
  local partial="${destination}.partial"
  mkdir -p "$(dirname "${destination}")"
  if [[ -f "${destination}" ]] && [[ "$(sha256_file "${destination}")" == "${expected_sha}" ]]; then
    return
  fi
  curl --fail --location --retry 3 --continue-at - "${source_url}" --output "${partial}"
  local actual_sha
  actual_sha="$(sha256_file "${partial}")"
  if [[ "${actual_sha}" != "${expected_sha}" ]]; then
    echo "Checksum mismatch for ${source_url}: expected ${expected_sha}, got ${actual_sha}" >&2
    exit 1
  fi
  mv "${partial}" "${destination}"
}

require_arm64_macos() {
  if [[ "$(uname -s)" != "Darwin" ]] || [[ "$(uname -m)" != "arm64" ]]; then
    echo "This release build requires native arm64 macOS." >&2
    exit 1
  fi
  xcrun --find clang >/dev/null
}

reject_nonredistributable_paths() {
  local target="$1"
  if strings "${target}" | grep -E -q '/(opt/homebrew|usr/local/Cellar|Users/[^/]+/(projects|work|src))/' ; then
    echo "Developer-machine or Homebrew path found in ${target}" >&2
    exit 1
  fi
  if otool -L "${target}" | tail -n +2 | grep -vE \
    '^[[:space:]]+(/usr/lib/|/System/Library/|@rpath/|@loader_path/|@executable_path/)' >/dev/null; then
    echo "Non-system dynamic dependency found in ${target}" >&2
    otool -L "${target}" >&2
    exit 1
  fi
}
