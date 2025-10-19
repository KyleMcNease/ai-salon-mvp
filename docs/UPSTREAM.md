# Upstream

Scribe is maintained as a first-party codebase without an active upstream.
Legacy imports have been snapshotted and live under `agents/scribe-agent/`
strictly for reference while we replace them with Scribe-native modules.

When in doubt:
- Treat everything inside `agents/scribe-agent/` as read-only vendor history.
- Implement new runtime features under `src/scribe_core/**` and `src/scribe_agents/**`.
- Record any overrides or removals in `docs/PATCHES.md` so collaborators know
  how the snapshot differs from our live implementation.
