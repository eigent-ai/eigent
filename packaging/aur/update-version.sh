#!/bin/bash
# Updates pkgver in PKGBUILD and regenerates .SRCINFO
# --verify downloads the AppImage and calculates sha256sum
set -e

cd "$(dirname "$0")"

VERSION="$1"
FLAG="$2"

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version> [--verify|--build]"
    exit 1
fi

sed -i "s/^pkgver=.*/pkgver=$VERSION/" PKGBUILD
sed -i "s/^pkgrel=.*/pkgrel=1/" PKGBUILD

if [[ "$FLAG" == "--verify" ]]; then
    # Note: URL also in install-appimage.sh and PKGBUILD
    URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/Eigent-${VERSION}.AppImage"
    TMPFILE=$(mktemp)
    trap "rm -f $TMPFILE" EXIT

    echo "Downloading $URL..."
    curl -fSL -o "$TMPFILE" "$URL"

    HASH=$(sha256sum "$TMPFILE" | cut -d' ' -f1)
    sed -i "s/^sha256sums=.*/sha256sums=('$HASH')/" PKGBUILD
    echo "sha256sum: $HASH"
fi

makepkg --printsrcinfo > .SRCINFO
echo "Updated to $VERSION"

[[ "$FLAG" == "--build" ]] && makepkg -f
