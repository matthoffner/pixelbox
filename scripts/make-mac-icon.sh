#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SVG="${ROOT_DIR}/assets/pixelbox-icon.svg"
SRC_PNG="${ROOT_DIR}/assets/pixelbox-icon.png"
ICONSET_DIR="${ROOT_DIR}/assets/pixelbox.iconset"
ICNS_OUT="${ROOT_DIR}/assets/pixelbox.icns"

if [[ -f "${SRC_SVG}" && ! -f "${SRC_PNG}" ]]; then
  qlmanage -t -s 1024 -o "${ROOT_DIR}/assets" "${SRC_SVG}" >/dev/null
  mv "${SRC_SVG}.png" "${SRC_PNG}"
fi

if [[ ! -f "${SRC_PNG}" ]]; then
  echo "Missing source icon: ${SRC_PNG} (or ${SRC_SVG})" >&2
  exit 1
fi

rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"

sips -z 16 16     "${SRC_PNG}" --out "${ICONSET_DIR}/icon_16x16.png" >/dev/null
sips -z 32 32     "${SRC_PNG}" --out "${ICONSET_DIR}/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "${SRC_PNG}" --out "${ICONSET_DIR}/icon_32x32.png" >/dev/null
sips -z 64 64     "${SRC_PNG}" --out "${ICONSET_DIR}/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "${SRC_PNG}" --out "${ICONSET_DIR}/icon_128x128.png" >/dev/null
sips -z 256 256   "${SRC_PNG}" --out "${ICONSET_DIR}/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "${SRC_PNG}" --out "${ICONSET_DIR}/icon_256x256.png" >/dev/null
sips -z 512 512   "${SRC_PNG}" --out "${ICONSET_DIR}/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "${SRC_PNG}" --out "${ICONSET_DIR}/icon_512x512.png" >/dev/null
sips -z 1024 1024 "${SRC_PNG}" --out "${ICONSET_DIR}/icon_512x512@2x.png" >/dev/null

iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_OUT}"
rm -rf "${ICONSET_DIR}"

echo "Generated ${ICNS_OUT}"
