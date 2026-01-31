# Eigent AUR Package

Arch Linux package for [Eigent](https://github.com/eigent-ai/eigent) via AUR.

## Scripts

### update-version.sh

Updates the package to a new version:

```bash
# Update version only
./update-version.sh 0.0.81

# Update version and calculate SHA256 from release
./update-version.sh 0.0.81 --verify

# Update, verify, and build locally
./update-version.sh 0.0.81 --build
```

### install-appimage.sh

Standalone AppImage installer (used by PKGBUILD, can also be run directly):

```bash
curl -fsSL https://raw.githubusercontent.com/eigent-ai/eigent/main/packaging/aur/install-appimage.sh | bash
```

## Manual Build

```bash
makepkg -si
```
