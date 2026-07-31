#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"

model_build_root="${SHORT_EDITOR_MODEL_BUILD:-${release_repo_root}/build/model}"
model_source="${model_build_root}/source"
model_release="${model_build_root}/release"
mkdir -p "${model_source}" "${model_release}"

node - "${release_repo_root}/resources/models/model-upstream.json" <<'NODE' |
const manifest = require(process.argv[2]);
for (const file of manifest.files) console.log(`${file.sha256}\t${file.path}`);
NODE
while IFS=$'\t' read -r expected_sha model_file; do
  model_url="https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${model_file}?download=true"
  download_verified "${model_url}" "${expected_sha}" "${model_source}/${model_file}"
done

node "${script_dir}/package-model.mjs" "${model_source}" "${model_release}"
cp "${model_release}/${MODEL_MANIFEST_NAME}" \
  "${release_repo_root}/resources/models/${MODEL_MANIFEST_NAME}"
echo "Packaged ${model_release}/${MODEL_ARCHIVE_NAME}"
