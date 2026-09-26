#!/usr/bin/env python3
"""
Build script for Live Uml Evo VS Code Extension
Creates a VSIX package for distribution
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

def run_command(cmd, cwd=None):
    """Run a shell command and return output"""
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return None
    return result.stdout

def main():
    # Get the extension directory
    extension_dir = Path(__file__).parent
    project_root = extension_dir
    
    print("Building Live Uml Evo VS Code Extension")
    print("=" * 50)
    
    # Check if vsce is installed
    print("Checking for vsce (VS Code Extension Manager)...")
    vsce_check = run_command("vsce --version")
    if not vsce_check:
        print("vsce not found. Installing...")
        run_command("npm install -g @vscode/vsce")
    
    # Check if we're in the right directory
    package_json = extension_dir / "package.json"
    if not package_json.exists():
        print(f"Error: package.json not found at {package_json}")
        return 1
    
    # Create bin directory at project root if it doesn't exist
    bin_dir = project_root / "bin"
    bin_dir.mkdir(exist_ok=True)
    
    # Clean previous builds
    print("Cleaning previous builds...")
    for file in bin_dir.glob("*.vsix"):
        file.unlink()
    
    # Build the extension
    print("Building VSIX package...")
    output = run_command("vsce package --allow-missing-repository", cwd=str(extension_dir))
    if not output:
        print("Failed to build extension")
        return 1
    
    # Find the created VSIX file
    vsix_files = list(extension_dir.glob("*.vsix"))
    if not vsix_files:
        print("No VSIX file created")
        return 1
    
    # Move VSIX file to bin directory at project root
    vsix_file = vsix_files[0]
    target_path = bin_dir / vsix_file.name
    shutil.move(str(vsix_file), str(target_path))
    
    print(f"\n✅ Build successful!")
    print(f"VSIX package created at: {target_path}")
    print(f"\nTo install in VS Code:")
    print(f"1. Open VS Code")
    print(f"2. Go to Extensions view (Ctrl+Shift+X)")
    print(f"3. Click '...' menu → 'Install from VSIX...'")
    print(f"4. Select: {target_path}")
    print(f"\nOr use command line:")
    print(f"code --install-extension {target_path}")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())