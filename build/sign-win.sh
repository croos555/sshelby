#!/usr/bin/env bash
# Signs one Windows binary with the Certum cloud certificate through ssign.
# Called by `tauri build` (bundle.windows.signCommand, set by CI) for the app executable before it is
# packed, then for the NSIS installer. Needs CERTUM_EMAIL and CERTUM_OTP (Base32 TOTP seed).
set -euo pipefail

file="$1"
# Certum's cloud API is occasionally slow to answer: retry before failing the build
for attempt in 1 2 3; do
  if ssign "$file"; then
    exit 0
  fi
  echo "ssign failed (attempt $attempt), retrying…" >&2
  sleep $((attempt * 10))
done
exit 1
