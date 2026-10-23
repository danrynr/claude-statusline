#!/usr/bin/env sh
# Install the Claude Code status line on macOS / Linux.
# Copies statusline.js and the plugin-actions mod into the Claude config dir and
# points settings.json at them.
set -eu

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$CFG/statusline.js"
MOD_DEST="$CFG/mods/plugin-actions"
SETTINGS="$CFG/settings.json"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js 18+ (e.g. 'brew install node' or your distro's package), then re-run." >&2
  exit 1
fi
NODE="$(command -v node)"

mkdir -p "$CFG"
cp "$SRC_DIR/statusline.js" "$DEST"
chmod +x "$DEST"

# Replace the mod folder wholesale so files dropped upstream don't linger.
mkdir -p "$CFG/mods"
rm -rf "$MOD_DEST"
cp -R "$SRC_DIR/mod/plugin-actions" "$MOD_DEST"

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
fi

# Edit settings.json with node so no jq is needed; keeps every other setting as-is.
"$NODE" - "$SETTINGS" "$NODE" "$DEST" "$MOD_DEST" <<'JS'
const fs = require('fs');
const path = require('path');
const [file, node, script, mod] = process.argv.slice(2);
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`error: ${file} is not valid JSON, not touching it: ${e.message}`); process.exit(1); }
}
s.statusLine = { type: 'command', command: `"${node}" "${script}"` };
// Load the mod in every session; keep any plugin dirs already listed.
s.env = s.env || {};
const dirs = (s.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(path.delimiter).filter(Boolean);
if (!dirs.includes(mod)) dirs.push(mod);
s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(path.delimiter);
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS

echo "Installed: $DEST"
echo "Installed mod: $MOD_DEST"
echo "statusLine and CLAUDE_CODE_PLUGIN_DIRS set in: $SETTINGS"
echo "Start a new Claude Code session to load them."
