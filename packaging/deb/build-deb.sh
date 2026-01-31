#!/bin/bash
# Build .deb package from AppImage
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-0.0.80}"
ARCH="amd64"
PKG_NAME="eigent"
PKG_DIR="${SCRIPT_DIR}/build/${PKG_NAME}_${VERSION}_${ARCH}"

echo "Building ${PKG_NAME} ${VERSION} .deb package..."

# Clean and create directory structure
rm -rf "${SCRIPT_DIR}/build"
mkdir -p "${PKG_DIR}/DEBIAN"
mkdir -p "${PKG_DIR}/opt/eigent"
mkdir -p "${PKG_DIR}/usr/bin"
mkdir -p "${PKG_DIR}/usr/share/applications"
mkdir -p "${PKG_DIR}/usr/share/icons/hicolor"
mkdir -p "${PKG_DIR}/usr/share/metainfo"

# Download AppImage
URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/Eigent-${VERSION}.AppImage"
APPIMAGE="${SCRIPT_DIR}/build/Eigent-${VERSION}.AppImage"
echo "Downloading from $URL..."
curl -fSL -o "$APPIMAGE" "$URL"
chmod +x "$APPIMAGE"

# Extract AppImage
cd "${SCRIPT_DIR}/build"
"$APPIMAGE" --appimage-extract
cd "$SCRIPT_DIR"

# Copy application files
cp -r "${SCRIPT_DIR}/build/squashfs-root/"* "${PKG_DIR}/opt/eigent/"

# Create launcher
cat > "${PKG_DIR}/usr/bin/eigent" << 'EOF'
#!/bin/bash
exec /opt/eigent/eigent "$@"
EOF
chmod +x "${PKG_DIR}/usr/bin/eigent"

# Desktop entry
cp "${SCRIPT_DIR}/build/squashfs-root/eigent.desktop" "${PKG_DIR}/usr/share/applications/"
sed -i "s|Exec=.*|Exec=/usr/bin/eigent %U|g" "${PKG_DIR}/usr/share/applications/eigent.desktop"
sed -i "s|Icon=.*|Icon=eigent|g" "${PKG_DIR}/usr/share/applications/eigent.desktop"

# Icons
for size in 16 32 48 64 128 256 512; do
    src="${SCRIPT_DIR}/build/squashfs-root/usr/share/icons/hicolor/${size}x${size}/apps/eigent.png"
    if [[ -f "$src" ]]; then
        mkdir -p "${PKG_DIR}/usr/share/icons/hicolor/${size}x${size}/apps"
        cp "$src" "${PKG_DIR}/usr/share/icons/hicolor/${size}x${size}/apps/eigent.png"
    fi
done

# AppStream metadata
cp "${SCRIPT_DIR}/../flatpak/ai.eigent.Eigent.metainfo.xml" "${PKG_DIR}/usr/share/metainfo/" 2>/dev/null || true

# Calculate installed size
INSTALLED_SIZE=$(du -sk "${PKG_DIR}" | cut -f1)

# Control file
cat > "${PKG_DIR}/DEBIAN/control" << EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Installed-Size: ${INSTALLED_SIZE}
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
Maintainer: Eigent AI <support@eigent.ai>
Homepage: https://eigent.ai
Description: AI-powered desktop agent for browser automation
 Eigent is an AI-powered desktop agent that automates browser tasks.
 It can navigate websites, fill forms, extract data, and perform
 complex multi-step workflows autonomously.
EOF

# Post-install script
cat > "${PKG_DIR}/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e
# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi
# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications || true
fi
# Fix chrome-sandbox permissions
if [[ -f /opt/eigent/chrome-sandbox ]]; then
    chmod 4755 /opt/eigent/chrome-sandbox
fi
EOF
chmod +x "${PKG_DIR}/DEBIAN/postinst"

# Post-remove script
cat > "${PKG_DIR}/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications || true
fi
EOF
chmod +x "${PKG_DIR}/DEBIAN/postrm"

# Fix permissions
find "${PKG_DIR}/opt/eigent" -type d -exec chmod 755 {} \;
find "${PKG_DIR}/opt/eigent" -type f -exec chmod 644 {} \;
chmod +x "${PKG_DIR}/opt/eigent/eigent"
[[ -f "${PKG_DIR}/opt/eigent/chrome-sandbox" ]] && chmod 4755 "${PKG_DIR}/opt/eigent/chrome-sandbox"

# Build package
dpkg-deb --build --root-owner-group "${PKG_DIR}"

echo ""
echo "Built: ${PKG_DIR}.deb"
echo "Install with: sudo dpkg -i ${PKG_DIR}.deb"
