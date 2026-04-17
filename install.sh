# install.sh — cache-ctrl CLI installer
# NOTE: For the recommended install method, use npm:
#   npm install -g @thecat69/cache-ctrl
#   cache-ctrl install
# This script is for local development only (creates symlinks to the repo).
#
# NOTE: No shebang by design — kept for shell compatibility across environments.
#       Always invoke explicitly: zsh install.sh
#       Do NOT add a shebang.
#
# Installs cache-ctrl as:
#   1. A global CLI command at ~/.local/bin/cache-ctrl
#   2. Opencode skills symlinked under ~/.config/opencode/skills/
#
# Run from: .config/opencode/custom-tool/cache-ctrl/
# Usage: zsh install.sh

set -euo pipefail

TOOL_DIR="$(pwd)"

# ── Prerequisite checks ────────────────────────────────────

if ! command -v bun &>/dev/null; then
	echo "ERROR: bun is not installed or not in PATH. Install bun first." >&2
	exit 1
fi

# ── Ensure target directories exist ───────────────────────

mkdir -p "${HOME}/.local/bin"

# ── CLI symlink ────────────────────────────────────────────
# ~/.local/bin/cache-ctrl → <cache-ctrl-dir>/bin/cache-ctrl.js
ln -sf "${TOOL_DIR}/bin/cache-ctrl.js" "${HOME}/.local/bin/cache-ctrl"
chmod +x "${TOOL_DIR}/bin/cache-ctrl.js"

# ── Install dependencies ───────────────────────────────────
# bun install is idempotent — safe to re-run
if [[ -f "${TOOL_DIR}/package.json" ]]; then
	bun install --cwd "${TOOL_DIR}"
fi

# ── Skills ────────────────────────────────────────────────
# ~/.config/opencode/skills/cache-ctrl-external/ → skills/cache-ctrl-external/
# ~/.config/opencode/skills/cache-ctrl-local/ → skills/cache-ctrl-local/
# ~/.config/opencode/skills/cache-ctrl-caller/ → skills/cache-ctrl-caller/
mkdir -p "${HOME}/.config/opencode/skills/cache-ctrl-external"
mkdir -p "${HOME}/.config/opencode/skills/cache-ctrl-local"
mkdir -p "${HOME}/.config/opencode/skills/cache-ctrl-caller"
ln -sf "${TOOL_DIR}/skills/cache-ctrl-external/SKILL.md" "${HOME}/.config/opencode/skills/cache-ctrl-external/SKILL.md"
ln -sf "${TOOL_DIR}/skills/cache-ctrl-local/SKILL.md" "${HOME}/.config/opencode/skills/cache-ctrl-local/SKILL.md"
ln -sf "${TOOL_DIR}/skills/cache-ctrl-caller/SKILL.md" "${HOME}/.config/opencode/skills/cache-ctrl-caller/SKILL.md"

# ── Verify ─────────────────────────────────────────────────
echo "cache-ctrl installed:"
echo "  CLI     → ${HOME}/.local/bin/cache-ctrl"
echo "  Skills  → ${HOME}/.config/opencode/skills/cache-ctrl-{external,local,caller}/SKILL.md"
