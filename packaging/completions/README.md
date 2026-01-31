# Shell Completions

Tab completion for the `eigent` command.

## Bash

```bash
# System-wide
sudo cp eigent.bash /etc/bash_completion.d/eigent

# User only
mkdir -p ~/.local/share/bash-completion/completions
cp eigent.bash ~/.local/share/bash-completion/completions/eigent
```

## Zsh

```bash
# System-wide
sudo cp eigent.zsh /usr/share/zsh/site-functions/_eigent

# User only (add ~/.zsh/completions to fpath in .zshrc)
mkdir -p ~/.zsh/completions
cp eigent.zsh ~/.zsh/completions/_eigent
```

Then restart your shell or run:
```bash
source ~/.bashrc  # or ~/.zshrc
```
