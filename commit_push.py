import subprocess

# Ask for commit message
commit_msg = input("Enter commit message: ").strip()
if not commit_msg:
    print("❌ Commit message is required.")
    exit(1)

# Stage all changes
subprocess.run(["git", "add", "."], check=True)

# Commit
subprocess.run(["git", "commit", "-m", commit_msg], check=True)

# Ensure branch is main
subprocess.run(["git", "branch", "-M", "main"], check=True)

# Push
subprocess.run(["git", "push", "-u", "origin", "main"], check=True)

print("✅ All changes committed and pushed.")

