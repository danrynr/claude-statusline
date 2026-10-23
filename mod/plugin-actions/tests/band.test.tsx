import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'plugin-actions',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const FILES: Record<string, unknown> = {
  '/cfg/plugins/installed_plugins.json': {
    plugins: {
      'foo@mkt': [{ version: '1.0.0', installedAt: '2020-01-01T00:00:00Z', lastUpdated: '2020-01-01T00:00:00Z' }],
      'bar@mkt': [{ version: '2.0.0', lastUpdated: '2099-01-01T00:00:00Z' }],
      'beta@mkt': [{ version: '1.0.0', lastUpdated: '2020-01-01T00:00:00Z' }],
      // Same version on a moved commit: Claude Code calls that up to date.
      'pinned@mkt': [{ version: '3.0.0', gitCommitSha: 'aaaaaaaaaaaa', lastUpdated: '2020-01-01T00:00:00Z' }],
      // Versioned by its commit, so a moved commit is an update.
      'bycommit@mkt': [{ version: 'bbbbbbbbbbbb', gitCommitSha: 'bbbbbbbbbbbb', lastUpdated: '2020-01-01T00:00:00Z' }],
    },
  },
  '/cfg/plugins/known_marketplaces.json': { mkt: { installLocation: '/mkt' } },
  '/mkt/.claude-plugin/marketplace.json': {
    plugins: [
      { name: 'foo', version: '1.2.0', source: './foo' },
      { name: 'bar', version: '2.0.0', source: './bar' },
      { name: 'beta', version: '2.0.0-beta.1', source: './beta' },
      { name: 'pinned', source: { source: 'url', sha: 'cccccccccccc' } },
      { name: 'bycommit', source: { source: 'url', sha: 'dddddddddddd' } },
    ],
  },
}

test('offers stable updates and a plugin reload, and runs the reload on press', async ($, on) => {
  const ran: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.read', (_, e) => {
    // The engine resolves paths for the host OS, so compare them in POSIX form.
    const f = FILES[e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')]
    if (!f) throw new Error('ENOENT')
    return { value: JSON.stringify(f) }
  })
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: Date.parse('2026-01-01T00:00:00Z') }))
  on('clock.every', () => ({ value: undefined }))
  // The timer fires as soon as its dispatch resolves, so scheduled work runs at once.
  on('clock.after', () => ({ value: undefined }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'update:foo@mkt' })).toBeDefined()
  // Same version and prereleases are not offered.
  expect(await ui.find({ key: 'update:bar@mkt' })).toBeUndefined()
  expect(await ui.find({ key: 'update:beta@mkt' })).toBeUndefined()
  expect(await ui.find({ key: 'update:pinned@mkt' })).toBeUndefined()
  expect(await ui.find({ key: 'update:bycommit@mkt' })).toBeDefined()
  // bar changed on disk after the session loaded plugins.
  expect((await ui.find({ key: 'reload-plugins' }))?.text).toMatch(/1 changed/)

  await ui.press({ key: 'reload-plugins' })
  expect(ran).toContain('reload-plugins')
  await ui.unmount()
})

test('the expanded list updates only what is ticked', async ($, on) => {
  const runs: string[][] = []
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.read', (_, e) => {
    const f = FILES[e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')]
    if (!f) throw new Error('ENOENT')
    return { value: JSON.stringify(f) }
  })
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: Date.parse('2026-01-01T00:00:00Z') }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const outcome = e.argv[3] === 'bycommit@mkt' ? 'up_to_date' : 'updated'
    return { value: { exitCode: 0, stdout: JSON.stringify({ updateOutcome: outcome }), stderr: '' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'expand' })
  expect((await ui.find({ key: 'pick:foo@mkt' }))?.text).toMatch(/^\[ \] foo/)
  // Nothing ticked yet, so nothing to update.
  expect(await ui.find({ key: 'update-selected' })).toBeUndefined()

  await ui.press({ key: 'pick:foo@mkt' })
  expect((await ui.find({ key: 'pick:foo@mkt' }))?.text).toMatch(/^\[x\] foo/)
  await ui.press({ key: 'update-selected' })
  expect(runs).toEqual([['claude', 'plugin', 'update', 'foo@mkt', '--json']])

  // One Claude Code reports as up to date leaves the list.
  await ui.press({ key: 'pick:bycommit@mkt' })
  await ui.press({ key: 'update-selected' })
  expect(await ui.find({ key: 'pick:bycommit@mkt' })).toBeUndefined()
  await ui.unmount()
})

test('/plugin-actions brings the band back after Hide', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.read', (_, e) => {
    const f = FILES[e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')]
    if (!f) throw new Error('ENOENT')
    return { value: JSON.stringify(f) }
  })
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: Date.parse('2026-01-01T00:00:00Z') }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'plugin-actions' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'expand' })).toBeUndefined()

  await $.command.run({ command: 'plugin-actions', args: '' })
  expect(await ui.find({ key: 'pick:foo@mkt' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own when nothing needs doing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
