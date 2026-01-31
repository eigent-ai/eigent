# Eigent RPM Package

RPM spec file for Fedora/RHEL/CentOS.

## Build

```bash
# Install build tools
sudo dnf install rpm-build rpmdevtools squashfs-tools

# Setup RPM build tree
rpmdev-setuptree

# Copy spec file
cp eigent.spec ~/rpmbuild/SPECS/

# Download source
spectool -g -R ~/rpmbuild/SPECS/eigent.spec

# Build RPM
rpmbuild -bb ~/rpmbuild/SPECS/eigent.spec
```

## Install

```bash
sudo dnf install ~/rpmbuild/RPMS/x86_64/eigent-*.rpm
```

## Uninstall

```bash
sudo dnf remove eigent
```

## COPR Repository

To publish to Fedora COPR:

1. Create account at https://copr.fedorainfracloud.org
2. Create new project
3. Upload the spec file
4. Users can then install via:

```bash
sudo dnf copr enable username/eigent
sudo dnf install eigent
```
