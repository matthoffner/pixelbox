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

if [[ -f "${MACOS_DIR}/PixelboxCore" ]]; then
  # Already finalized: PixelboxCore is the real app and must never be touched by
  # mv/cp here. Refresh whichever other file holds the supervisor — but only if
  # there's exactly one candidate. .DS_Store is Finder cruft (dropped by "Show
  # Package Contents"), never a binary, so it's excluded rather than being
  # allowed to masquerade as the supervisor.
  SUPERVISOR_CANDIDATES=$(find "${MACOS_DIR}" -maxdepth 1 -type f -not -name "PixelboxCore" -not -name ".DS_Store")
  SUPERVISOR_COUNT=$(printf '%s\n' "${SUPERVISOR_CANDIDATES}" | grep -c . || true)

  if [[ "${SUPERVISOR_COUNT}" -ne 1 ]]; then
    echo "Expected exactly one non-PixelboxCore executable in ${MACOS_DIR} to refresh, found ${SUPERVISOR_COUNT}:" >&2
    printf '%s\n' "${SUPERVISOR_CANDIDATES}" >&2
    exit 1
  fi

  SUPERVISOR_NAME=$(basename "${SUPERVISOR_CANDIDATES}")
  cp "${SUPERVISOR_BINARY}" "${MACOS_DIR}/${SUPERVISOR_NAME}"
  chmod +x "${MACOS_DIR}/${SUPERVISOR_NAME}"
  echo "Already finalized: Contents/MacOS/PixelboxCore is untouched; refreshed the supervisor at Contents/MacOS/${SUPERVISOR_NAME}"
  exit 0
fi

FOUND_FILES=$(find "${MACOS_DIR}" -maxdepth 1 -type f -not -name ".DS_Store")
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
