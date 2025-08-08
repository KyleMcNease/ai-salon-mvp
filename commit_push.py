import subprocess, sys

def run(cmd, check=True):
    return subprocess.run(cmd, check=check, text=True, capture_output=True)

msg = input("Enter commit message: ").strip()
if not msg:
    print("❌ Commit message is required.")
    sys.exit(1)

# Is there anything to commit?
status = run(["git", "status", "--porcelain"], check=False)
dirty = bool(status.stdout.strip())

if dirty:
    run(["git", "add", "."], check=True)
    run(["git", "commit", "-m", msg], check=True)
else:
    print("ℹ️  Nothing to commit; skipping commit step.")

# Ensure main & push
run(["git", "branch", "-M", "main"], check=True)
run(["git", "push", "-u", "origin", "main"], check=True)
print("✅ Up to date with origin/main.")

