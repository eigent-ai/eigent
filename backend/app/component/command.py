import os
import shutil
import glob
import platform


def bun():
    if platform.system() == "Windows":
        return os.path.expanduser("~/.eigent/bin/bun.exe")
    return os.path.expanduser("~/.eigent/bin/bun")


def uv():
    if platform.system() == "Windows":
        return os.path.expanduser("~/.eigent/bin/uv.exe")
    return os.path.expanduser("~/.eigent/bin/uv")


def get_node_executable():
    """Get the node executable path with multiple fallbacks for all users on all platforms."""
    system = platform.system()
    
    # 1. First check if we have a bundled node with eigent
    if system == "Windows":
        bundled_node = os.path.expanduser("~/.eigent/bin/node.exe")
    else:
        bundled_node = os.path.expanduser("~/.eigent/bin/node")
    
    if os.path.exists(bundled_node) and os.access(bundled_node, os.X_OK):
        return bundled_node
    
    # 2. Check if node is in system PATH (works for all platforms)
    system_node = shutil.which("node")
    if system_node and os.access(system_node, os.X_OK):
        return system_node
    
    # 3. Platform-specific common locations
    if system == "Windows":
        # Windows common paths
        common_paths = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "nodejs", "node.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "nodejs", "node.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs", "node.exe"),
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Program Files (x86)\\nodejs\\node.exe",
        ]
        
        # Check Windows NVM
        nvm_home = os.environ.get("NVM_HOME", os.path.expanduser("~/AppData/Roaming/nvm"))
        if os.path.exists(nvm_home):
            nvm_pattern = os.path.join(nvm_home, "v*", "node.exe")
            nvm_nodes = glob.glob(nvm_pattern)
            if nvm_nodes:
                common_paths.extend(sorted(nvm_nodes, reverse=True))
        
        # Check Volta on Windows
        volta_node = os.path.expanduser("~/.volta/bin/node.exe")
        if os.path.exists(volta_node):
            common_paths.append(volta_node)
            
    elif system == "Darwin":  # macOS
        common_paths = [
            "/usr/local/bin/node",  # Homebrew Intel
            "/opt/homebrew/bin/node",  # Homebrew Apple Silicon
            "/usr/bin/node",  # System
            "/opt/local/bin/node",  # MacPorts
        ]
    else:  # Linux and other Unix-like systems
        common_paths = [
            "/usr/bin/node",
            "/usr/local/bin/node",
            "/opt/node/bin/node",
            "/snap/bin/node",  # Snap packages
        ]
    
    # Check common paths
    for node_path in common_paths:
        if node_path and os.path.exists(node_path) and os.access(node_path, os.X_OK):
            return node_path
    
    # 4. Check cross-platform version managers
    # NVM (macOS/Linux)
    if system != "Windows":
        nvm_pattern = os.path.expanduser("~/.nvm/versions/node/*/bin/node")
        nvm_nodes = glob.glob(nvm_pattern)
        if nvm_nodes:
            nvm_nodes.sort()
            latest_node = nvm_nodes[-1]
            if os.access(latest_node, os.X_OK):
                return latest_node
    
    # fnm (all platforms)
    if system == "Windows":
        fnm_pattern = os.path.expanduser("~/AppData/Roaming/fnm/node-versions/*/installation/node.exe")
    else:
        fnm_pattern = os.path.expanduser("~/.fnm/node-versions/*/installation/bin/node")
    
    fnm_nodes = glob.glob(fnm_pattern)
    if fnm_nodes:
        fnm_nodes.sort()
        latest_node = fnm_nodes[-1]
        if os.access(latest_node, os.X_OK):
            return latest_node
    
    # Volta (all platforms)
    if system == "Windows":
        volta_node = os.path.expanduser("~/.volta/bin/node.exe")
    else:
        volta_node = os.path.expanduser("~/.volta/bin/node")
    
    if os.path.exists(volta_node) and os.access(volta_node, os.X_OK):
        return volta_node
    
    # 5. If nothing found, raise a helpful error
    if system == "Windows":
        install_msg = (
            "Node.js not found. Please install Node.js from https://nodejs.org/ "
            "or via Chocolatey: 'choco install nodejs' "
            "or via Scoop: 'scoop install nodejs'"
        )
    elif system == "Darwin":
        install_msg = (
            "Node.js not found. Please install Node.js from https://nodejs.org/ "
            "or via Homebrew: 'brew install node'"
        )
    else:
        install_msg = (
            "Node.js not found. Please install Node.js from https://nodejs.org/ "
            "or via your package manager (apt, yum, dnf, etc.)"
        )
    
    raise RuntimeError(install_msg)


def ensure_node_wrapper():
    """Create a node wrapper that uv can use as a fallback."""
    system = platform.system()
    wrapper_dir = os.path.expanduser("~/.eigent/bin")
    
    if system == "Windows":
        wrapper_name = "node.exe"
        wrapper_path = os.path.join(wrapper_dir, wrapper_name)
    else:
        wrapper_name = "node"
        wrapper_path = os.path.join(wrapper_dir, wrapper_name)
    
    # If wrapper already exists and works, skip
    if os.path.exists(wrapper_path):
        return wrapper_path
    
    try:
        # Find system node
        node_exe = get_node_executable()
        
        # Create wrapper script
        os.makedirs(wrapper_dir, exist_ok=True)
        
        if system == "Windows":
            # For Windows, create a batch file wrapper
            batch_wrapper = os.path.join(wrapper_dir, "node.cmd")
            wrapper_content = f"""@echo off
"{node_exe}" %*
"""
            with open(batch_wrapper, 'w') as f:
                f.write(wrapper_content)
            
            # Also try to create a symlink or copy for .exe
            try:
                # Try creating a symlink first (requires admin on older Windows)
                os.symlink(node_exe, wrapper_path)
            except (OSError, NotImplementedError):
                # If symlink fails, copy the executable
                import shutil as shutil_copy
                try:
                    shutil_copy.copy2(node_exe, wrapper_path)
                except Exception:
                    # If copy also fails, rely on the batch wrapper
                    return batch_wrapper
        else:
            # Unix-like systems (macOS, Linux)
            wrapper_content = f"""#!/bin/bash
# Auto-generated node wrapper for Eigent
exec "{node_exe}" "$@"
"""
            with open(wrapper_path, 'w') as f:
                f.write(wrapper_content)
            
            # Make executable
            os.chmod(wrapper_path, 0o755)
        
        return wrapper_path
    except Exception:
        # If we can't create wrapper, that's okay
        pass
    
    return None
