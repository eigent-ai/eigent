# Eigent AUR Package

Arch Linux package for [Eigent](https://github.com/eigent-ai/eigent) via AUR.

## Quick Install (AppImage)

```bash
curl -fsSL https://raw.githubusercontent.com/eigent-ai/eigent/main/packaging/aur/install-appimage.sh | bash -s 0.0.80
```

This installs the AppImage to `~/.local/bin` and creates a desktop entry.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/eigent-ai/eigent/main/packaging/aur/uninstall-appimage.sh | bash
```

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

Standalone AppImage installer with desktop integration:

```bash
./install-appimage.sh 0.0.80
```

### uninstall-appimage.sh

Removes AppImage, symlink, desktop entry, and icon:

```bash
./uninstall-appimage.sh
```

## Automation

The `aur-update.yml` workflow automatically creates a PR to update the AUR package when a new release is published.

## Manual Build

```bash
makepkg -si
```
