"""
Wrapper for nodejs-wheel to provide node executable functionality.
"""
import os
import sys
import subprocess
import tempfile
from pathlib import Path
import platform


def get_nodejs_wheel_wrapper():
    """
    Create a Python script wrapper that can be used as a node executable.
    Returns the path to the wrapper script.
    """
    # Create a temporary directory for the wrapper
    wrapper_dir = Path.home() / ".eigent" / "nodejs-wrapper"
    wrapper_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine the wrapper extension based on platform
    is_windows = platform.system() == "Windows"
    wrapper_name = "node-wrapper.py"
    wrapper_path = wrapper_dir / wrapper_name
    
    # Create the Python wrapper script
    wrapper_content = '''#!/usr/bin/env python3
import sys
import os

# Ensure nodejs-wheel is in the path
try:
    from nodejs_wheel import node
except ImportError:
    print("Error: nodejs-wheel not installed", file=sys.stderr)
    sys.exit(1)

# Remove the script name from arguments
args = sys.argv[1:]

# Call node with the arguments
try:
    exit_code = node(args)
    sys.exit(exit_code)
except Exception as e:
    print(f"Error running node: {e}", file=sys.stderr)
    sys.exit(1)
'''
    
    # Write the wrapper script
    with open(wrapper_path, 'w') as f:
        f.write(wrapper_content)
    
    # Make it executable on Unix-like systems
    if not is_windows:
        os.chmod(wrapper_path, 0o755)
    
    # Create a shell script wrapper for better compatibility
    if is_windows:
        shell_wrapper_name = "node.bat"
        shell_wrapper_path = wrapper_dir / shell_wrapper_name
        shell_content = f'''@echo off
"{sys.executable}" "{wrapper_path}" %*
'''
    else:
        shell_wrapper_name = "node"
        shell_wrapper_path = wrapper_dir / shell_wrapper_name
        shell_content = f'''#!/bin/bash
exec "{sys.executable}" "{wrapper_path}" "$@"
'''
    
    with open(shell_wrapper_path, 'w') as f:
        f.write(shell_content)
    
    if not is_windows:
        os.chmod(shell_wrapper_path, 0o755)
    
    return str(shell_wrapper_path)


def run_node_with_nodejs_wheel(args, **kwargs):
    """
    Run node command using nodejs-wheel with subprocess-compatible interface.
    
    Args:
        args: List of arguments to pass to node
        **kwargs: Additional arguments for subprocess.Popen
        
    Returns:
        subprocess.Popen instance
    """
    # Get the wrapper path
    wrapper_path = get_nodejs_wheel_wrapper()
    
    # Prepare the command
    if isinstance(args, str):
        # If a string command is passed, prepend the wrapper
        cmd = f'"{wrapper_path}" {args}'
        shell = True
    else:
        # If a list is passed, insert the wrapper at the beginning
        cmd = [wrapper_path] + args
        shell = False
    
    # Override shell parameter if provided in kwargs
    if 'shell' in kwargs:
        shell = kwargs.pop('shell')
    
    # Run the command
    return subprocess.Popen(cmd, shell=shell, **kwargs)


def get_node_executable():
    """
    Get a node executable path that works with subprocess.
    For nodejs-wheel, this returns the wrapper script path.
    """
    try:
        # First, try to import nodejs-wheel to ensure it's available
        import nodejs_wheel
        
        # Return the wrapper path
        return get_nodejs_wheel_wrapper()
    except ImportError:
        # Fall back to system node if nodejs-wheel is not available
        import shutil
        system_node = shutil.which("node")
        if system_node:
            return system_node
        
        # If no node found, raise error
        raise RuntimeError(
            "Node.js is required but not found. "
            "Please ensure nodejs-wheel is installed: "
            "uv pip install nodejs-wheel"
        )


# For backward compatibility
def get_node_command():
    """
    Get the node command as a list suitable for subprocess.
    """
    node_path = get_node_executable()
    return [node_path]