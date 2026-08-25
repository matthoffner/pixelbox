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

CORE_BINARY=$(find "${MACOS_DIR}" -maxdepth 1 -type f | head -n 1)
if [[ -z "${CORE_BINARY}" ]]; then
  echo "No executable found in ${MACOS_DIR}" >&2
  exit 1
fi

CORE_NAME=$(basename "${CORE_BINARY}")
mv "${CORE_BINARY}" "${MACOS_DIR}/PixelboxCore"
cp "${SUPERVISOR_BINARY}" "${MACOS_DIR}/${CORE_NAME}"
chmod +x "${MACOS_DIR}/${CORE_NAME}" "${MACOS_DIR}/PixelboxCore"

echo "Finalized: Contents/MacOS/${CORE_NAME} is now the supervisor; the real app is Contents/MacOS/PixelboxCore"
