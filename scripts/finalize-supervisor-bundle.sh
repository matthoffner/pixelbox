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

if [[ -e "${MACOS_DIR}/PixelboxCore" ]]; then
  # Already finalized: PixelboxCore is the real app and must never be touched by
  # mv/cp here. Just refresh whichever other file holds the supervisor.
  SUPERVISOR_NAME=""
  while IFS= read -r -d '' f; do
    name=$(basename "${f}")
    if [[ "${name}" != "PixelboxCore" ]]; then
      SUPERVISOR_NAME="${name}"
      break
    fi
  done < <(find "${MACOS_DIR}" -maxdepth 1 -type f -print0)

  if [[ -z "${SUPERVISOR_NAME}" ]]; then
    echo "Bundle already has Contents/MacOS/PixelboxCore but no launched-executable file to refresh in ${MACOS_DIR}" >&2
    exit 1
  fi

  cp "${SUPERVISOR_BINARY}" "${MACOS_DIR}/${SUPERVISOR_NAME}"
  chmod +x "${MACOS_DIR}/${SUPERVISOR_NAME}"
  echo "Already finalized: Contents/MacOS/PixelboxCore is untouched; refreshed the supervisor at Contents/MacOS/${SUPERVISOR_NAME}"
  exit 0
fi

FOUND_FILES=$(find "${MACOS_DIR}" -maxdepth 1 -type f)
FOUND_COUNT=$(printf '%s\n' "${FOUND_FILES}" | grep -c . || true)

if [[ "${FOUND_COUNT}" -ne 1 ]]; then
  echo "Expected exactly one executable in ${MACOS_DIR} before finalizing, found ${FOUND_COUNT}:" >&2
  printf '%s\n' "${FOUND_FILES}" >&2
  exit 1
fi

CORE_BINARY="${FOUND_FILES}"
CORE_NAME=$(basename "${CORE_BINARY}")
mv "${CORE_BINARY}" "${MACOS_DIR}/PixelboxCore"
cp "${SUPERVISOR_BINARY}" "${MACOS_DIR}/${CORE_NAME}"
chmod +x "${MACOS_DIR}/${CORE_NAME}" "${MACOS_DIR}/PixelboxCore"

echo "Finalized: Contents/MacOS/${CORE_NAME} is now the supervisor; the real app is Contents/MacOS/PixelboxCore"
