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
| header | model, effort level, caveman mode (only if you use caveman), output style, folder, git branch |
| `CTX` | context window used, free tokens, cached / new / last output tokens; warns at 80% |
| `5H` / `7D` | plan 5-hour and 7-day usage with time until reset (subscription logins only); `LIMITS plan limits n/a` otherwise |
| `SESS` | session input and output token totals, API-equivalent cost |
| `TOOLS` | tool calls this session, the most used ones, the last one |
| `EXT` | codegraph status (only if you use codegraph), enabled plugins and which ones this session used, MCP servers called |

Bars are green up to 50%, yellow up to 80%, red after.

### Codegraph status

| `EXT` shows | When |
| --- | --- |
| `● codegraph 2×` | a `.codegraph/` index sits at or above the folder, and this session used codegraph twice |
| `● codegraph idle` | an index exists, but this session hasn't used codegraph yet |
| `○ codegraph no index` | `codegraph` is on `PATH`, but this folder isn't indexed yet (run `codegraph init`) |
| nothing | codegraph isn't installed and this session never ran it |

## Buttons: the `plugin-actions` mod

A status line can't run commands when clicked. It can only open links. For real buttons, `mod/plugin-actions` is a [mod](https://code.claude.com/docs/en/plugins/mods/overview) that draws a band above the prompt. The band only shows when something needs doing:

```
plugins: [Reload plugins (1 changed)] [Update foo 1.0.0 → 1.2.0] [Update all 2] [List ▸] [Hide]
```

| Button | Hotkey | What it does |
| --- | --- | --- |
| **Reload plugins (n changed)** | `p` | Runs `/reload-plugins`. Shows when a plugin was installed or updated on disk after the session loaded plugins. |
| **Reload skills (n changed)** | `s` | Runs `/reload-skills`. Shows when a `SKILL.md` under `~/.claude/skills` or `.claude/skills` changed after skills were loaded. |
| **Update `<plugin>`** | | Runs `claude plugin update <plugin>@<marketplace>` for one plugin. The band shows up to 3. |
| **Update all** | `u` | Updates every plugin in the list, one after another. |
| **List ▸** / **Collapse ▾** | `l` | Opens or folds the full list. |
| **Hide** | | Hides the band until something new comes up. |

Click a button, or press ctrl+x tab to focus the band and then the hotkey. Clicking needs a terminal that reports clicks, such as fullscreen rendering (`"tui": "fullscreen"`).

### Updating plugins

1. Press **List ▸**. Every available update has its own row: `[ ] name old → new`.
2. Tick the ones you want. **Select all** and **Select none** help.
3. Press **Update selected** (`u`). The band shows `updating <name>…` while each one installs.
4. When it finishes, **Reload plugins** appears. Press it to load the new versions into this session.

Run `/plugin-actions` to bring the band back after **Hide**. The band opens on the full list, and the command reports how many updates and changes are waiting.

To update from a terminal instead, run `claude plugin update <plugin>@<marketplace>`, then `/reload-plugins` in the session.

### Which updates are offered

The mod reads the local marketplace copies that Claude Code refreshes itself. It makes no network calls.

- The latest version is the marketplace entry's `version`, or else the plugin's own `plugin.json`.
- Only stable versions are offered. Prereleases such as `-beta` or `-rc` are skipped.
- A new marketplace commit counts only for a plugin whose version is its commit hash. Claude Code updates by version, so a new commit with the same version isn't an update.
- If `claude plugin update` replies `up_to_date`, the plugin leaves the list. It comes back if the marketplace later offers a newer version.
- If a marketplace declares an install command, the mod won't accept it for you. A toast asks you to run the update in a terminal and confirm it there.

### Loading the mod

The mod needs Claude Code v2.1.287 or later. To load it for one session:

```sh
claude --plugin-dir mod/plugin-actions
```

To load it in every session, set `CLAUDE_CODE_PLUGIN_DIRS` to the folder's absolute path, either in your environment or in the `env` block of `~/.claude/settings.json`.

Mods run inside Claude Code with your permissions. Read `mod/plugin-actions/hooks/register.tsx` before you load it. To check what it hooks and calls, run `claude plugin validate mod/plugin-actions`. Its tests run with `claude plugin test mod/plugin-actions`.

## Notes

- Effort is read from the status line input, then `CLAUDE_CODE_EFFORT_LEVEL`, then `effortLevel` in settings files. If none is set, it is hidden.
- Caveman and codegraph are optional. The caveman badge shows only when the caveman plugin is enabled or its mode files exist. For codegraph, see [Codegraph status](#codegraph-status). Other plugins, such as superpowers, appear in `EXT` only once the session uses them.
- Caveman mode is read from `~/.claude/.caveman-sessions/<session>.mode`, falling back to `~/.claude/.caveman-active`.
- Tool and plugin counts come from the session transcript. The read position is cached per session in `~/.claude/cache/statusline/` (private to your user), so each refresh only reads new lines.
- Every string from outside the script (transcript, project settings, folder and branch names) has control characters stripped before it is printed, and effort is shown only for known levels.
