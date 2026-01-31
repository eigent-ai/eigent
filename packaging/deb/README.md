# Eigent Debian Package

Build .deb packages for Debian/Ubuntu from the AppImage release.

## Build

```bash
./build-deb.sh 0.0.80
```

## Install

```bash
sudo dpkg -i build/eigent_0.0.80_amd64.deb
sudo apt-get install -f  # Install dependencies if needed
```

## Uninstall

```bash
sudo apt remove eigent
```

## Dependencies

Build requires:
- `curl`
- `dpkg-deb`

Runtime requires:
- `libgtk-3-0`
- `libnotify4`
- `libnss3`
- `libxss1`
- `libxtst6`
- `xdg-utils`
