# Bash completion for eigent
# Install: cp eigent.bash /etc/bash_completion.d/eigent
#      or: cp eigent.bash ~/.local/share/bash-completion/completions/eigent

_eigent() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Basic options (Electron apps typically support these)
    opts="--help --version --no-sandbox --disable-gpu --enable-logging"

    if [[ ${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
        return 0
    fi

    # Complete file paths
    COMPREPLY=( $(compgen -f -- ${cur}) )
    return 0
}

complete -F _eigent eigent
