#!/usr/bin/env bash
set -euo pipefail

# Only the disposable GitHub-hosted Linux VM may install this system profile.
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" ]]; then
  echo 'This setup is only for GitHub-hosted Linux CI.' >&2
  exit 1
fi
: "${PLAYWRIGHT_BROWSERS_PATH:?Set the dedicated Playwright cache first}"
if [[ "$PLAYWRIGHT_BROWSERS_PATH" != "${RUNNER_TEMP:?}/releasecheck-browsers" ]]; then
  echo 'Refusing a browser path outside the dedicated CI cache.' >&2
  exit 1
fi

# Ubuntu 24.04 restricts user namespaces for downloaded Chromium binaries.
# Allow only the browser executables in this job's cache. Keep AppArmor's global
# policy and Chromium's own sandbox enabled. Based on Chromium's guidance:
# https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
sudo tee /etc/apparmor.d/releasecheck-playwright > /dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>
profile releasecheck-chromium "$PLAYWRIGHT_BROWSERS_PATH/**/chrome" flags=(unconfined) {
  userns,
}
profile releasecheck-headless "$PLAYWRIGHT_BROWSERS_PATH/**/chrome-headless-shell" flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/releasecheck-playwright
