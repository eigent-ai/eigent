# Eigent Man Page

Manual page for the `eigent` command.

## Install

```bash
# System-wide
sudo install -Dm644 eigent.1 /usr/share/man/man1/eigent.1
sudo mandb

# User only
mkdir -p ~/.local/share/man/man1
install -m644 eigent.1 ~/.local/share/man/man1/
mandb ~/.local/share/man
```

## View

```bash
man eigent
```

## Generate from Markdown (optional)

If you prefer writing in Markdown:

```bash
# Install pandoc
sudo apt install pandoc

# Convert
pandoc eigent.1.md -s -t man -o eigent.1
```
