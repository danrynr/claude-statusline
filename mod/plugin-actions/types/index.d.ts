export type Update = { id: string; name: string; from: string; to: string }

export type Snapshot = {
  updates: Update[]
  // Plugins installed or updated on disk since the last reload.
  pluginsChanged: string[]
  // Skills added or changed on disk since the last reload.
  skillsChanged: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'plugin-actions': {
      // When plugins / skills were last loaded, in ms since the epoch. Kept in
      // state so a reload of this mod (which /reload-plugins causes) keeps them.
      pluginsLoadedAt: number
      skillsLoadedAt: number
      snapshot: Snapshot
      busy: string
      // Signature of the snapshot the person hid; the band returns when it changes.
      hiddenFor: string
      // Whether the band shows the full list, and the update ids ticked in it.
      isExpanded: boolean
      selected: string[]
      // Plugin id to the target Claude Code reported as already installed; not offered again.
      upToDate: Record<string, string>
    }
  }
}
