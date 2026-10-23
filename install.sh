#!/usr/bin/env sh
# Install the Claude Code status line on macOS / Linux.
# Copies statusline.js into the Claude config dir and points settings.json at it.
set -eu

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$CFG/statusline.js"
SETTINGS="$CFG/settings.json"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js 18+ (e.g. 'brew install node' or your distro's package), then re-run." >&2
  exit 1
fi
NODE="$(command -v node)"

mkdir -p "$CFG"
cp "$SRC_DIR/statusline.js" "$DEST"
chmod +x "$DEST"

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
fi

# Edit settings.json with node so no jq is needed; keeps every other setting as-is.
"$NODE" - "$SETTINGS" "$NODE" "$DEST" <<'JS'
const fs = require('fs');
const [file, node, script] = process.argv.slice(2);
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`error: ${file} is not valid JSON, not touching it: ${e.message}`); process.exit(1); }
}
s.statusLine = { type: 'command', command: `"${node}" "${script}"` };
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
JS

echo "Installed: $DEST"
echo "statusLine set in: $SETTINGS"
echo "Send a message in Claude Code to see it."
