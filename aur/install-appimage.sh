#!/bin/bash
# Direct AppImage installer for Eigent
# Usage: ./install-appimage.sh [version]

set -e

VERSION="${1:-0.0.80}"
INSTALL_DIR="${HOME}/.local/bin"
APPIMAGE_NAME="Eigent-${VERSION}.AppImage"
DOWNLOAD_URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/${APPIMAGE_NAME}"

echo "Installing Eigent v${VERSION}..."

mkdir -p "${INSTALL_DIR}"

echo "Downloading from ${DOWNLOAD_URL}..."
curl -L -o "${INSTALL_DIR}/${APPIMAGE_NAME}" "${DOWNLOAD_URL}"
chmod +x "${INSTALL_DIR}/${APPIMAGE_NAME}"

# Create symlink
ln -sf "${INSTALL_DIR}/${APPIMAGE_NAME}" "${INSTALL_DIR}/eigent"

echo ""
echo "Installed to: ${INSTALL_DIR}/${APPIMAGE_NAME}"
echo "Symlink: ${INSTALL_DIR}/eigent"
echo ""
echo "Make sure ${INSTALL_DIR} is in your PATH, then run: eigent"
