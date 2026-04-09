# install.sh — cache-ctrl tool installer
#
# NOTE: No shebang by design — kept for shell compatibility across environments.
#       Always invoke explicitly: zsh install.sh
#       Do NOT add a shebang.
#
# Installs cache-ctrl as:
#   1. A global CLI command at ~/.local/bin/cache-ctrl
#   2. Opencode custom tools at .opencode/tools/cache_ctrl.ts
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
mkdir -p "${HOME}/.config/opencode/tools"

# ── CLI symlink ────────────────────────────────────────────
# ~/.local/bin/cache-ctrl → <cache-ctrl-dir>/src/index.ts
ln -sf "${TOOL_DIR}/src/index.ts" "${HOME}/.local/bin/cache-ctrl"
chmod +x "${TOOL_DIR}/src/index.ts"

# ── opencode custom tool symlink ───────────────────────────────────────────
# .opencode/tools/cache_ctrl.ts → <cache-ctrl-dir>/cache_ctrl.ts
# Tool names: cache_ctrl_search, cache_ctrl_list, cache_ctrl_inspect,
#             cache_ctrl_invalidate, cache_ctrl_check_freshness, cache_ctrl_check_files
ln -sf "${TOOL_DIR}/cache_ctrl.ts" "${HOME}/.config/opencode/tools/cache_ctrl.ts"

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
echo "  Tools   → ${HOME}/.config/opencode/tools/cache_ctrl.ts"
echo "  Skills  → ${HOME}/.config/opencode/skills/cache-ctrl-{external,local,caller}/SKILL.md"
