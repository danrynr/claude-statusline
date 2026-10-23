import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot, Update } from '../types'

const EMPTY: Snapshot = { updates: [], pluginsChanged: [], skillsChanged: [] }
const pluginsLoadedAt = atom({ plugin: 'plugin-actions', key: 'pluginsLoadedAt' } as const, 0)
const skillsLoadedAt = atom({ plugin: 'plugin-actions', key: 'skillsLoadedAt' } as const, 0)
const snapshot = atom({ plugin: 'plugin-actions', key: 'snapshot' } as const, EMPTY)
const busy = atom({ plugin: 'plugin-actions', key: 'busy' } as const, '')
const hiddenFor = atom({ plugin: 'plugin-actions', key: 'hiddenFor' } as const, '')
const isExpanded = atom({ plugin: 'plugin-actions', key: 'isExpanded' } as const, false)
const upToDate = atom({ plugin: 'plugin-actions', key: 'upToDate' } as const, {} as Record<string, string>)
const selected = atom({ plugin: 'plugin-actions', key: 'selected' } as const, [] as string[])

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const PRERELEASE = /^(alpha|beta|rc|pre|dev|next|canary|nightly)/i
const COMMIT = /^[0-9a-f]{7,40}$/
const SHOWN = 3
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])

// Marketplace files are other people's text: keep names and versions printable and short.
const clean = (s: unknown, max = 40) =>
  String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max)

const newerSemver = (a: string, b: string): boolean | null => {
  const x = SEMVER.exec(a)
  const y = SEMVER.exec(b)
  if (!x || !y) return null
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(y[i]) > Number(x[i])
  return false
}

const signature = (s: Snapshot) =>
  JSON.stringify([s.updates.map(u => u.id + u.to), s.pluginsChanged, s.skillsChanged])

async function configDir($: EngineInterface) {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir) return dir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${home}/.claude`
}

async function readJson($: EngineInterface, file: string): Promise<any> {
  try {
    return JSON.parse(await $.fs.read(file))
  } catch {
    return {}
  }
}

// Latest is the marketplace entry's version, else the plugin's own plugin.json; prereleases
// are never offered. A moved commit counts only for a plugin versioned by its commit:
// Claude Code updates by version, so a new commit with the same version is no update.
async function check($: EngineInterface, cfg: string, since: number, known: Record<string, string>) {
  const installed = (await readJson($, `${cfg}/plugins/installed_plugins.json`)).plugins ?? {}
  const markets = await readJson($, `${cfg}/plugins/known_marketplaces.json`)
  const listings: Record<string, any[]> = {}
  const updates: Update[] = []
  const changed: string[] = []
  for (const [id, entries] of Object.entries<any>(installed)) {
    const at = id.lastIndexOf('@')
    const name = id.slice(0, at)
    const market = id.slice(at + 1)
    const inst = Array.isArray(entries) ? entries[0] : undefined
    if (!inst) continue
    if (Date.parse(inst.lastUpdated ?? inst.installedAt ?? '') > since) changed.push(clean(name))
    const loc = markets[market]?.installLocation
    if (typeof loc !== 'string') continue
    listings[market] ??= (await readJson($, `${loc}/.claude-plugin/marketplace.json`)).plugins ?? []
    const entry = Array.isArray(listings[market]) ? listings[market].find(p => p?.name === name) : undefined
    if (!entry) continue
    const src = entry.source
    let latest = typeof entry.version === 'string' ? entry.version : ''
    if (!latest && typeof src === 'string' && !src.includes('..')) {
      latest = String((await readJson($, `${loc}/${src}/.claude-plugin/plugin.json`)).version ?? '')
    }
    const m = SEMVER.exec(latest)
    if (m?.[4] && PRERELEASE.test(m[4])) continue
    let newer = newerSemver(String(inst.version), latest)
    let to = latest
    if (newer === null && COMMIT.test(String(inst.version)) && typeof src?.sha === 'string' && typeof inst.gitCommitSha === 'string') {
      newer = src.sha !== inst.gitCommitSha
      to = src.sha.slice(0, 7)
    }
    // Claude Code already said this one is up to date at this target.
    if (newer && known[id] === to) continue
    if (newer) updates.push({ id: clean(id, 80), name: clean(name), from: clean(inst.version, 20), to: clean(to, 20) })
  }
  return { updates, changed }
}

// Skill folders (user and project) whose SKILL.md changed since skills were last loaded.
async function changedSkills($: EngineInterface, dirs: string[], since: number) {
  const out: string[] = []
  for (const dir of dirs) {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const ent of entries) {
      if (ent.kind !== 'dir') continue
      const st = await $.fs.stat(`${dir}/${ent.name}/SKILL.md`).catch(() => undefined)
      if (st && st.mtimeMs > since) out.push(clean(ent.name))
    }
  }
  return out
}

// Where to look, set at session.start.
let cfg = ''
let cwd = ''

async function refresh($: EngineInterface) {
  if (!cfg) return
  const { updates, changed } = await check($, cfg, await read($, pluginsLoadedAt), await read($, upToDate))
  const skills = await changedSkills($, [`${cfg}/skills`, `${cwd}/.claude/skills`], await read($, skillsLoadedAt))
  await update($, snapshot, () => ({ updates, pluginsChanged: changed, skillsChanged: skills }))
}

async function markLoaded($: EngineInterface, command: string) {
  const now = await $.clock.now()
  if (command === 'reload-plugins') await update($, pluginsLoadedAt, () => now)
  else await update($, skillsLoadedAt, () => now)
  await refresh($)
}

async function reload($: EngineInterface, command: 'reload-plugins' | 'reload-skills') {
  await update($, busy, () => command)
  try {
    await $.command.run({ command, args: '' })
  } catch (err) {
    $.ui.toast(`/${command} failed: ${clean((err as Error)?.message, 120)}`)
  } finally {
    await update($, busy, () => '')
  }
}

// Updates go through the CLI without -y: a marketplace that declares an install
// command must be confirmed by the person, so that case is handed back to them.
async function install($: EngineInterface, list: Update[]) {
  for (const u of list) {
    await update($, busy, () => `update ${u.name}`)
    try {
      const r = await $.process.run(['claude', 'plugin', 'update', u.id, '--json'], { timeoutMs: 180_000 })
      let outcome = ''
      try {
        outcome = String(JSON.parse(r.stdout.trim().split('\n').pop() ?? '').updateOutcome ?? '')
      } catch {}
      if (outcome === 'up_to_date') {
        await update($, upToDate, map => ({ ...map, [u.id]: u.to }))
        $.ui.toast(`${u.name} is already up to date`)
      } else if (r.exitCode !== 0) {
        const why = r.stdout.includes('shownCommand')
          ? 'needs confirmation; run in a terminal'
          : clean((r.stderr || r.stdout).trim().split('\n')[0], 120)
        $.ui.toast(`${u.name}: ${why}  (claude plugin update ${u.id})`)
      }
    } catch (err) {
      $.ui.toast(`${u.name}: ${clean((err as Error)?.message, 120)}`)
    }
  }
  await update($, busy, () => '')
  await refresh($)
}

// A press dispatch has a 10 s budget, and /reload-plugins reloads this mod mid-press.
// So a press only schedules the work; the timer runs it outside the press dispatch.
function later($: EngineInterface, work: () => Promise<void>) {
  $.clock.after(0, () => void work())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cfg = await configDir($)
    cwd = e.cwd
    const now = await $.clock.now()
    // A reload ends whatever was running, so nothing is busy any more.
    await update($, busy, () => '')
    // First load of the session only: a reload of this mod keeps the baseline.
    if (!(await read($, pluginsLoadedAt))) await update($, pluginsLoadedAt, () => now)
    if (!(await read($, skillsLoadedAt))) await update($, skillsLoadedAt, () => now)
    await refresh($)
    $.clock.every(60_000, () => void refresh($))
    await $.command.register({ name: 'plugin-actions', description: 'Show the plugin update and reload band, expanded' })
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  // Brings the band back after Hide, opened on the full list.
  on('command.run', { command: 'plugin-actions' }, async $ => {
    await update($, hiddenFor, () => '')
    await update($, isExpanded, () => true)
    await refresh($)
    const s = await read($, snapshot)
    return { text: `${s.updates.length} updates, ${s.pluginsChanged.length} plugins and ${s.skillsChanged.length} skills changed.` }
  })

  // A reload typed by hand counts too, not only one from the band.
  for (const command of ['reload-plugins', 'reload-skills']) {
    on('command.run', { command }, async ($, e, next) => {
      const result = await next(e)
      await markLoaded($, command)
      return result
    })
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    const working = await read($, busy)
    const isEmpty = !s.updates.length && !s.pluginsChanged.length && !s.skillsChanged.length
    if (e.props.hasSurvey || (!working && (isEmpty || (await read($, hiddenFor)) === signature(s)))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    if (working) {
      return (
        <Box>
          <Text dimColor>plugins: {working}…</Text>
        </Box>
      )
    }

    // Picks of plugins no longer offered (updated, or gone from the marketplace) drop out.
    const picked = (await read($, selected)).filter(id => s.updates.some(u => u.id === id))
    const expanded = await read($, isExpanded)
    const more = s.updates.length - SHOWN
    const bar = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>plugins:</Text>
        {s.pluginsChanged.length > 0 && (
          <Button
            key="reload-plugins"
            hotkey="p"
            label={`Reload plugins (${s.pluginsChanged.length} changed)`}
            onPress={() => later($, () => reload($, 'reload-plugins'))}
          />
        )}
        {s.skillsChanged.length > 0 && (
          <Button
            key="reload-skills"
            hotkey="s"
            label={`Reload skills (${s.skillsChanged.length} changed)`}
            onPress={() => later($, () => reload($, 'reload-skills'))}
          />
        )}
        {!expanded &&
          s.updates.slice(0, SHOWN).map(u => (
            <Button key={`update:${u.id}`} onPress={() => later($, () => install($, [u]))}>
              Update {u.name} <Text dimColor>{u.from} → </Text>
              <Text color="green">{u.to}</Text>
            </Button>
          ))}
        {!expanded && s.updates.length > 1 && (
          <Button
            key="update-all"
            hotkey="u"
            label={`Update all ${s.updates.length}${more > 0 ? ` (+${more} not shown)` : ''}`}
            onPress={() => later($, () => install($, s.updates))}
          />
        )}
        <Button
          key="expand"
          hotkey="l"
          label={expanded ? 'Collapse ▾' : 'List ▸'}
          onPress={() => update($, isExpanded, v => !v)}
        />
        <Button key="hide" label="Hide (/plugin-actions shows it)" onPress={() => update($, hiddenFor, () => signature(s))} />
      </Box>
    )
    if (!expanded) return bar

    return (
      <Box flexDirection="column">
        {bar}
        {s.updates.length > 0 && <Text bold>Updates ({s.updates.length})</Text>}
        {s.updates.map(u => (
          <Button key={`pick:${u.id}`} onPress={() => update($, selected, list => toggle(list, u.id))}>
            {picked.includes(u.id) ? '[x] ' : '[ ] '}
            {u.name} <Text dimColor>{u.from} → </Text>
            <Text color="green">{u.to}</Text>
          </Button>
        ))}
        {s.updates.length > 0 && (
          <Box flexDirection="row" gap={1}>
            <Button key="select-all" label="Select all" onPress={() => update($, selected, () => s.updates.map(u => u.id))} />
            <Button key="select-none" label="Select none" onPress={() => update($, selected, () => [])} />
            {picked.length > 0 && (
              <Button
                key="update-selected"
                hotkey="u"
                label={`Update selected (${picked.length})`}
                onPress={() => later($, () => install($, s.updates.filter(u => picked.includes(u.id))))}
              />
            )}
          </Box>
        )}
        {s.pluginsChanged.length > 0 && (
          <Text>
            <Text bold>Changed plugins: </Text>
            <Text dimColor>{s.pluginsChanged.join(', ')}</Text>
          </Text>
        )}
        {s.skillsChanged.length > 0 && (
          <Text>
            <Text bold>Changed skills: </Text>
            <Text dimColor>{s.skillsChanged.join(', ')}</Text>
          </Text>
        )}
        {s.updates.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>How to update</Text>
            <Text dimColor>1. Tick each plugin to update: click its row, or press ctrl+x tab, move with the arrows, then Enter.</Text>
            <Text dimColor>2. Press Update selected (u). The band shows "updating …" while each one installs.</Text>
            <Text dimColor>3. When it finishes, Reload plugins (p) appears. Press it to load the new versions into this session.</Text>
            <Text dimColor>From a terminal instead: claude plugin update &lt;plugin&gt;@&lt;marketplace&gt;, then /reload-plugins here.</Text>
            <Text dimColor>If a toast says an update needs confirmation, run that command in a terminal and accept it there.</Text>
          </Box>
        )}
      </Box>
    )
  })
}
