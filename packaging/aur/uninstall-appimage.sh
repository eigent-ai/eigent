#!/bin/bash
# Uninstall Eigent AppImage
set -e

INSTALL_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons"

echo "Uninstalling Eigent..."

rm -f "$INSTALL_DIR"/Eigent-*.AppImage
rm -f "$INSTALL_DIR/eigent"
rm -f "$DESKTOP_DIR/eigent.desktop"
rm -f "$ICON_DIR/eigent.png"

echo "Done."
