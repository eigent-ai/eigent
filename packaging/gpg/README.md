# Eigent GPG Signing

GPG key for signing Eigent releases.

## Key Info

| Field | Value |
|-------|-------|
| Name | Eric Vogt (Eigent AUR) |
| Email | aur@ericvogt.com |
| Key ID | `8E662D4AC7C4EF50` |
| Fingerprint | `AA25DDBF558DA33374FB5A318E662D4AC7C4EF50` |
| Expires | 2028-01-31 |
| Keyserver | keyserver.ubuntu.com |

## For Users: Verify Downloads

```bash
# Import the public key
gpg --keyserver keyserver.ubuntu.com --recv-keys 8E662D4AC7C4EF50

# Or import from file
gpg --import eigent-public.asc

# Verify a release
gpg --verify Eigent-0.0.81.AppImage.asc Eigent-0.0.81.AppImage
```

Expected output:
```
gpg: Good signature from "Eric Vogt (Eigent AUR) <aur@ericvogt.com>"
```

## For Maintainers: Sign Releases

```bash
# Sign a release file
./sign-release.sh Eigent-0.0.81.AppImage

# Upload both files to GitHub Release:
# - Eigent-0.0.81.AppImage
# - Eigent-0.0.81.AppImage.asc
```

## Backup

**IMPORTANT:** Backup the private key securely!

```bash
# Export private key (store safely!)
gpg --armor --export-secret-keys 8E662D4AC7C4EF50 > eigent-private.asc

# Import on another machine
gpg --import eigent-private.asc
```

## AUR Integration

The PKGBUILD can verify signatures automatically:

```bash
validpgpkeys=('AA25DDBF558DA33374FB5A318E662D4AC7C4EF50')
```
