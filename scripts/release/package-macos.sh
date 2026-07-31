#!/bin/bash

set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${script_dir}/common.sh"
require_arm64_macos

cd "${release_repo_root}"
restore_development_native_binding() {
  # electron-builder rebuilds this in-place for Electron's ABI. Restore the
  # workspace's Node ABI even if packaging fails or is interrupted.
  npm rebuild better-sqlite3 >/dev/null
}
trap restore_development_native_binding EXIT

npm run validate:runtime
npm run build

developer_identity="$(security find-identity -v -p codesigning 2>/dev/null |
  sed -n 's/.*"\\(Developer ID Application:.*\\)"/\\1/p' | head -1)"
if [[ -z "${developer_identity}" ]]; then
  echo "No Developer ID Application identity is available; building unsigned artifacts."
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 -c.mac.identity=null
else
  echo "Signing with ${developer_identity%% (*}."
  CSC_NAME="${developer_identity}" npx electron-builder --mac dmg --arm64
fi

release_app="dist/mac-arm64/Short Editor.app"
release_dmg="dist/Short Editor-$(node -p "require('./package.json').version")-arm64.dmg"
if [[ -n "${developer_identity}" ]] && [[ -n "${SHORT_EDITOR_NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "${release_dmg}" \
    --keychain-profile "${SHORT_EDITOR_NOTARY_PROFILE}" --wait
  xcrun stapler staple "${release_app}"
  xcrun stapler staple "${release_dmg}"
fi

node "${script_dir}/record-release-evidence.mjs" "${release_app}" "${release_dmg}"
