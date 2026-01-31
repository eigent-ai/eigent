# Eigent Flatpak

Flatpak package for [Eigent](https://github.com/eigent-ai/eigent).

## Build locally

```bash
# Install flatpak-builder
sudo apt install flatpak-builder

# Add Flathub repo
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo

# Install SDK and runtime
flatpak install flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08
flatpak install flathub org.electronjs.Electron2.BaseApp//23.08

# Build
flatpak-builder --force-clean build-dir ai.eigent.Eigent.yml

# Install locally
flatpak-builder --user --install --force-clean build-dir ai.eigent.Eigent.yml

# Run
flatpak run ai.eigent.Eigent
```

## Update version

Update the version and SHA256 in `ai.eigent.Eigent.yml`, or use the update script:

```bash
../aur/update-version.sh 0.0.81 --verify
# Then manually update the yml with the new version and hash
```
