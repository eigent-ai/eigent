# Eigent Nix Package

Nix flake for [Eigent](https://github.com/eigent-ai/eigent).

## Run directly

```bash
nix run github:eigent-ai/eigent#eigent
```

## Install to profile

```bash
nix profile install github:eigent-ai/eigent#eigent
```

## Add to NixOS configuration

```nix
{
  inputs.eigent.url = "github:eigent-ai/eigent";

  # In your configuration.nix or home.nix:
  environment.systemPackages = [ inputs.eigent.packages.${system}.eigent ];
  # or for home-manager:
  home.packages = [ inputs.eigent.packages.${system}.eigent ];
}
```

## Update hash

After a new release, update the sha256 hash in `flake.nix`:

```bash
nix-prefetch-url https://github.com/eigent-ai/eigent/releases/download/v0.0.81/Eigent-0.0.81.AppImage
```
