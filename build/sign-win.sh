#!/usr/bin/env bash
# Signs one Windows binary with the Certum cloud certificate through ssign.
# Called by `tauri build` (bundle.windows.signCommand, set by CI) for the app executable before it is
# packed, then for the NSIS installer. Needs CERTUM_EMAIL and CERTUM_OTP (Base32 TOTP seed).
set -euo pipefail

file="$1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# ssign replaces the file by renaming a temp copy over it, which Windows refuses while the bundler
# (or Defender) still has the original open: sign a copy, then write the result back in place.
copy="$tmp/$(basename "$file")"
cp "$file" "$copy"

signed=0
# Certum's cloud API is occasionally slow to answer: retry before failing the build
for attempt in 1 2 3; do
  if ssign "$copy"; then
    signed=1
    break
  fi
  echo "ssign failed (attempt $attempt), retrying…" >&2
  sleep $((attempt * 10))
done
[ "$signed" = 1 ] || exit 1

for attempt in 1 2 3 4 5; do
  if cat "$copy" > "$file"; then
    exit 0
  fi
  echo "could not write the signed file back (attempt $attempt), retrying…" >&2
  sleep 3
done
exit 1
