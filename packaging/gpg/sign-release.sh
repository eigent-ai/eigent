#!/bin/bash
# Sign a release file with the Eigent GPG key
# Usage: ./sign-release.sh <file>
set -e

KEY_ID="8E662D4AC7C4EF50"
FILE="$1"

if [[ -z "$FILE" ]]; then
    echo "Usage: $0 <file>"
    echo ""
    echo "Example:"
    echo "  $0 Eigent-0.0.81.AppImage"
    echo ""
    echo "This creates: Eigent-0.0.81.AppImage.asc"
    exit 1
fi

if [[ ! -f "$FILE" ]]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

echo "Signing $FILE with key $KEY_ID..."
gpg --detach-sign --armor --local-user "$KEY_ID" "$FILE"

echo ""
echo "Created: ${FILE}.asc"
echo ""
echo "Verify with:"
echo "  gpg --verify ${FILE}.asc"
