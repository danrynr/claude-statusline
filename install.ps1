# Install the Claude Code status line on Windows.
# Copies statusline.js and the plugin-actions mod into the Claude config dir and
# points settings.json at them.
$ErrorActionPreference = 'Stop'

$cfg = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$dest = Join-Path $cfg 'statusline.js'
$modDest = Join-Path $cfg 'mods\plugin-actions'
$settings = Join-Path $cfg 'settings.json'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "node not found. Install Node.js 18+ (e.g. 'winget install OpenJS.NodeJS.LTS'), then re-run."
}

New-Item -ItemType Directory -Force $cfg | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'statusline.js') $dest -Force

# Replace the mod folder wholesale so files dropped upstream don't linger.
New-Item -ItemType Directory -Force (Split-Path $modDest) | Out-Null
if (Test-Path $modDest) { Remove-Item $modDest -Recurse -Force }
Copy-Item (Join-Path $PSScriptRoot 'mod\plugin-actions') $modDest -Recurse

if (Test-Path $settings) {
  Copy-Item $settings "$settings.bak.$(Get-Date -Format yyyyMMddHHmmss)"
}

# Edit settings.json with node so formatting and every other setting are kept.
$js = @'
const fs = require('fs');
const path = require('path');
const [file, script, mod] = process.argv.slice(2);
let s = {};
if (fs.existsSync(file)) {
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`error: ${file} is not valid JSON, not touching it: ${e.message}`); process.exit(1); }
}
s.statusLine = { type: 'command', command: `node "${script.replace(/\\/g, '/')}"` };
// Load the mod in every session; keep any plugin dirs already listed.
s.env = s.env || {};
const dirs = (s.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(path.delimiter).filter(Boolean);
if (!dirs.includes(mod)) dirs.push(mod);
s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(path.delimiter);
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
'@
# Run from a temp file: PowerShell 5.1 strips quotes from `node -e` arguments.
$tmp = Join-Path ([IO.Path]::GetTempPath()) "statusline-install-$PID.js"
Set-Content -Path $tmp -Value $js -Encoding UTF8
try { & $node.Source $tmp $settings $dest $modDest } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Installed: $dest"
Write-Host "Installed mod: $modDest"
Write-Host "statusLine and CLAUDE_CODE_PLUGIN_DIRS set in: $settings"
Write-Host "Start a new Claude Code session to load them."
