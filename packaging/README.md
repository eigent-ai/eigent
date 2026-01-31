# Eigent Packaging

Distribution packages for Eigent on Linux.

## Formats

| Format | Directory | Status |
|--------|-----------|--------|
| [AUR (Arch)](#aur) | `aur/` | ✅ Ready |
| [Flatpak](#flatpak) | `flatpak/` | ✅ Ready |
| [Debian/Ubuntu](#debian) | `deb/` | ✅ Ready |
| [Nix](#nix) | `nix/` | ✅ Ready |
| [RPM (Fedora)](#rpm) | `rpm/` | ✅ Ready |

## Quick Install

### AUR
```bash
# With yay
yay -S eigent-bin

# Manual
git clone https://aur.archlinux.org/eigent-bin.git
cd eigent-bin && makepkg -si
```

### Flatpak
```bash
flatpak install flathub ai.eigent.Eigent
```

### Debian/Ubuntu
```bash
# Download .deb from releases or build:
./packaging/deb/build-deb.sh
sudo dpkg -i eigent_*.deb
```

### Nix
```bash
# Flake
nix profile install github:eigent-ai/eigent#eigent

# Or in flake.nix
inputs.eigent.url = "github:eigent-ai/eigent";
```

### RPM (Fedora/RHEL)
```bash
# Build from spec
rpmbuild -bb packaging/rpm/eigent.spec
sudo dnf install ~/rpmbuild/RPMS/x86_64/eigent-*.rpm
```

## Additional Files

| File | Description |
|------|-------------|
| `man/eigent.1` | Man page |
| `autostart/` | Login autostart entry |
| `update-all.sh` | Update all package versions |
| `tests/` | Packaging validation tests |

## Updating Versions

Update all packaging files to a new version:

```bash
# Without hash verification (manual update)
./packaging/update-all.sh 0.0.81

# With hash verification (downloads AppImage)
./packaging/update-all.sh 0.0.81 --verify
```

This updates: AUR, Flatpak, Deb, Nix, RPM

## Testing

```bash
# Run all validation tests
./packaging/tests/test-packaging.sh

# Verbose output
./packaging/tests/test-packaging.sh --verbose
```

## Directory Structure

```
packaging/
├── aur/                    # Arch User Repository
│   ├── PKGBUILD
│   ├── .SRCINFO
│   └── install-appimage.sh
├── flatpak/                # Flatpak
│   ├── ai.eigent.Eigent.yml
│   └── ai.eigent.Eigent.metainfo.xml
├── deb/                    # Debian/Ubuntu
│   └── build-deb.sh
├── nix/                    # NixOS/Nix
│   └── flake.nix
├── rpm/                    # Fedora/RHEL/CentOS
│   └── eigent.spec
├── man/                    # Documentation
│   └── eigent.1
├── autostart/              # Desktop autostart
│   └── eigent-autostart.desktop
├── tests/                  # Validation tests
│   └── test-packaging.sh
└── update-all.sh           # Version updater
```

## Contributing

1. Make changes to packaging files
2. Run tests: `./packaging/tests/test-packaging.sh`
3. Ensure version consistency across all formats
4. Submit PR - CI will validate automatically
