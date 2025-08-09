#!/usr/bin/env python3
import subprocess, sys

def sh(cmd):
    return subprocess.run(cmd, check=True)

# Stage all changes
sh(["git", "add", "-A"])

# Commit with a default message or the provided one
msg = sys.argv[1] if len(sys.argv) > 1 else "chore: scaffold sync"
try:
    sh(["git", "commit", "-m", msg])
except subprocess.CalledProcessError:
    print("Nothing to commit or commit failed.")
    sys.exit(0)

# Find current branch
cp = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], check=True, capture_output=True, text=True)
branch = cp.stdout.strip()

# Push to origin/current-branch
sh(["git", "push", "-u", "origin", branch])
print(f"Pushed branch: {branch}")
