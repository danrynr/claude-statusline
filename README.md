# claude-statusline

A multi-line status line for Claude Code:

```
Opus 5.5  ·  ● high  ·  🪨 caveman   │   ~/project ⎇ dev
CTX    ||||||||||||||||||||  42%   84.2k / 200k   116k free   cache 80.0k · new 4.2k · out 900
5H     ||||||||||||||||||||  23%   ↻ resets in 2h 13m
7D     ||||||||||||||||||||  61%   ↻ resets in 3d 11h
SESS   512k in  ·  18.0k out  ·  $3.42 api-equiv
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
| `5H` / `7D` | plan 5-hour and 7-day usage with time until reset (subscription logins only); `LIMITS plan limits n/a` otherwise |
| `SESS` | session input and output token totals, API-equivalent cost |
| `TOOLS` | tool calls this session, the most used ones, the last one |
| `EXT` | codegraph index and usage, enabled plugins and which ones this session used, MCP servers called |

Bars are green up to 50%, yellow up to 80%, red after.

## Buttons: the `plugin-actions` mod

A status line can't run commands when clicked. It can only open links. For real buttons, `mod/plugin-actions` is a [mod](https://code.claude.com/docs/en/plugins/mods/overview) that draws a band above the prompt when something needs doing:

- **Reload plugins**: plugins were installed or updated on disk since the session loaded them. Runs `/reload-plugins`.
- **Reload skills**: a `SKILL.md` under `~/.claude/skills` or `.claude/skills` changed since skills were loaded. Runs `/reload-skills`.
- **Update `<plugin>`** / **Update all**: runs `claude plugin update <plugin>@<marketplace>`. Prereleases are never offered. If a marketplace declares an install command, the mod doesn't accept it for you. It shows a toast asking you to run the update in a terminal.
- **List ▸** (hotkey `l`): expands the band into the full list. Each update has a `[ ]` toggle, with **Select all**, **Select none** and **Update selected** (hotkey `u`). The list also names the plugins and skills that changed on disk. **Collapse ▾** folds the band back to one row.
- **Hide**: hides the band until something new comes up. Run `/plugin-actions` to bring it back, opened on the full list.

The mod needs Claude Code v2.1.287 or later. To try it for one session:

```sh
claude --plugin-dir mod/plugin-actions
```

Mods run inside Claude Code with your permissions. Read `mod/plugin-actions/hooks/register.tsx` before you load it. To check what it hooks and calls, run `claude plugin validate mod/plugin-actions`. Its tests run with `claude plugin test mod/plugin-actions`.

## Notes

- Effort is read from the status line input, then `CLAUDE_CODE_EFFORT_LEVEL`, then `effortLevel` in settings files. If none is set, it is hidden.
- Caveman mode is read from `~/.claude/.caveman-sessions/<session>.mode`, falling back to `~/.claude/.caveman-active`.
- Tool and plugin counts come from the session transcript. The read position is cached in the system temp dir as `cc-statusline-<session>.json`, so each refresh only reads new lines.
