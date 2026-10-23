# claude-statusline

A multi-line status line for Claude Code:

```
Opus 5.5  ·  high  ·  🪨 caveman   │   ~/project ⎇ dev
CTX    ||||||||||||||||||||  42%   84.2k / 200k   116k free   cache 80.0k · new 4.2k · out 900
USAGE  5h ||||||||||||  23% ↻2h13m   7d ||||||||||||  61% ↻3d11h   session 512k in · 18.0k out · $3.42
TOOLS  31 calls   Bash 22  Edit 5  Read 3  Write 1   last Bash
EXT    ● codegraph 2×   plugins 36: caveman hook
```

It runs locally on every refresh and never calls the model, so it uses no tokens.

## Requirements

- Claude Code
- Node.js 18+ on `PATH`
- `git` (optional, for the branch name)

## Install

macOS / Linux:

```sh
sh install.sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Both installers copy `statusline.js` to `~/.claude/` (or `$CLAUDE_CONFIG_DIR`), back up `settings.json`, and set its `statusLine` entry. Every other setting is kept.

## What each row shows

| Row | Contents |
| --- | --- |
| header | model, effort level, caveman mode, output style, folder, git branch |
| `CTX` | context window used, free tokens, cached / new / last output tokens; warns at 80% |
| `USAGE` | plan 5-hour and 7-day usage with reset times (subscription logins only), session token totals, API-equivalent cost |
| `TOOLS` | tool calls this session, the most used ones, the last one |
| `EXT` | codegraph index and usage, enabled plugins and which ones this session used, MCP servers called |

Bars are green up to 50%, yellow up to 80%, red after.

## Notes

- Effort is read from the status line input, then `CLAUDE_CODE_EFFORT_LEVEL`, then `effortLevel` in settings files. If none is set, it is hidden.
- Caveman mode is read from `~/.claude/.caveman-sessions/<session>.mode`, falling back to `~/.claude/.caveman-active`.
- Tool and plugin counts come from the session transcript. The read position is cached per session in `~/.claude/cache/statusline/` (private to your user), so each refresh only reads new lines.
- Every string from outside the script (transcript, project settings, folder and branch names) has control characters stripped before it is printed, and effort is shown only for known levels.
