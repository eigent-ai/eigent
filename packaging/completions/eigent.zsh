#compdef eigent
# Zsh completion for eigent
# Install: cp eigent.zsh /usr/share/zsh/site-functions/_eigent
#      or: cp eigent.zsh ~/.zsh/completions/_eigent (and add to fpath)

_eigent() {
    local -a opts
    opts=(
        '--help[Show help]'
        '--version[Show version]'
        '--no-sandbox[Disable sandbox mode]'
        '--disable-gpu[Disable GPU acceleration]'
        '--enable-logging[Enable logging]'
    )

    _arguments -s \
        $opts \
        '*:file:_files'
}

_eigent "$@"
