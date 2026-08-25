#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <path-to-.app-bundle> <path-to-PixelboxSupervisor-binary>" >&2
  exit 1
fi

APP_BUNDLE="$1"
SUPERVISOR_BINARY="$2"
MACOS_DIR="${APP_BUNDLE}/Contents/MacOS"

if [[ ! -d "${MACOS_DIR}" ]]; then
  echo "Expected ${MACOS_DIR} to exist — did 'zig build package' run first?" >&2
  exit 1
fi

# The candidate is whatever `zero-native package` installs as the bundle's
# CFBundleExecutable. Anything named PixelboxCore is our own previous
# promotion; .DS_Store is Finder cruft (dropped by "Show Package Contents"),
# never a binary, so it's excluded rather than being allowed to masquerade as
# the candidate. Requiring exactly one candidate keeps an unexpected extra file
# from being silently overwritten.
CANDIDATES=$(find "${MACOS_DIR}" -maxdepth 1 -type f -not -name "PixelboxCore" -not -name ".DS_Store")
CANDIDATE_COUNT=$(printf '%s\n' "${CANDIDATES}" | grep -c . || true)

if [[ "${CANDIDATE_COUNT}" -ne 1 ]]; then
  echo "Expected exactly one non-PixelboxCore executable in ${MACOS_DIR}, found ${CANDIDATE_COUNT}:" >&2
  printf '%s\n' "${CANDIDATES}" >&2
  exit 1
fi

CANDIDATE="${CANDIDATES}"
CANDIDATE_NAME=$(basename "${CANDIDATE}")

# Discriminate on *what the candidate is*, not on whether PixelboxCore already
# exists. `zero-native package` never cleans the bundle — it just overwrites
# the CFBundleExecutable with a freshly built core — so on a re-run the
# candidate is a brand new core sitting next to a stale PixelboxCore from the
# previous run. Keying off "PixelboxCore exists" there would cp the supervisor
# straight over that fresh core and pin PixelboxCore to the stale binary
# forever, silently.
if cmp -s "${CANDIDATE}" "${SUPERVISOR_BINARY}"; then
  # The candidate is already the supervisor (finalize re-run with no
  # intervening package): PixelboxCore is the real app and must not be touched.
  if [[ ! -f "${MACOS_DIR}/PixelboxCore" ]]; then
    echo "Contents/MacOS/${CANDIDATE_NAME} is the supervisor but Contents/MacOS/PixelboxCore is missing — the bundle has no app to launch." >&2
    exit 1
  fi
  ACTION="refreshed the supervisor at Contents/MacOS/${CANDIDATE_NAME} (PixelboxCore untouched)"
else
  # The candidate is a freshly packaged core: promote it to PixelboxCore,
  # replacing any stale core from a previous run.
  mv "${CANDIDATE}" "${MACOS_DIR}/PixelboxCore"
  chmod +x "${MACOS_DIR}/PixelboxCore"
  ACTION="promoted the packaged app to Contents/MacOS/PixelboxCore"
fi

cp "${SUPERVISOR_BINARY}" "${CANDIDATE}"
chmod +x "${CANDIDATE}"

echo "Finalized: ${ACTION}; Contents/MacOS/${CANDIDATE_NAME} is now the supervisor"
