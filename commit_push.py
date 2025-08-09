#!/usr/bin/env python3
import subprocess

# Get the current branch name
branch_name = subprocess.check_output(
    ["git", "branch", "--show-current"]
).decode().strip()

print(f"📍 Current branch: {branch_name}")

# Stage all changes
subprocess.run(["git", "add", "."], check=True)

# Commit with user-provided message
commit_msg = input("Enter commit message: ")
try:
    subprocess.run(["git", "commit", "-m", commit_msg], check=True)
except subprocess.CalledProcessError:
    print("⚠️  Nothing to commit — working tree clean.")

# Push to the current branch
subprocess.run(["git", "push", "-u", "origin", branch_name], check=True)

print(f"✅ Changes pushed to origin/{branch_name}")

