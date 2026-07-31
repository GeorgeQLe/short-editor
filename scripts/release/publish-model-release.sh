#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"

release_repository="GeorgeQLe/short-editor"
release_tag="${MODEL_RELEASE_TAG}"
release_directory="${release_repo_root}/build/model/release"
archive="${release_directory}/${MODEL_ARCHIVE_NAME}"
manifest="${release_directory}/${MODEL_MANIFEST_NAME}"

test -f "${archive}"
test -f "${manifest}"
node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1]));
  const bytes = fs.readFileSync(process.argv[2]);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== manifest.archive.size || digest !== manifest.archive.sha256) {
    throw new Error("Staged model archive does not match its manifest");
  }
' "${manifest}" "${archive}"

visibility="$(gh repo view "${release_repository}" --json visibility --jq .visibility)"
if [[ "${visibility}" != "PUBLIC" ]]; then
  echo "Refusing publication: ${release_repository} is ${visibility}, but Setup Center requires anonymous public download access." >&2
  exit 1
fi
if gh release view "${release_tag}" --repo "${release_repository}" >/dev/null 2>&1; then
  echo "Refusing to mutate existing immutable release ${release_tag}." >&2
  exit 1
fi

gh release create "${release_tag}" \
  "${archive}" \
  "${manifest}" \
  --repo "${release_repository}" \
  --title "faster-whisper small.en e0e3c0a" \
  --notes "Pinned MIT-licensed Systran/faster-whisper-small.en model revision ${MODEL_REVISION}. Download occurs only after explicit Setup Center consent; transcription remains local and telemetry is disabled."
