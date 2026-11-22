/**
 * Browser half of the sidebar pin persistence bundle.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar` keeps its panel pin choices in a plain
 * in-memory snapshot store (`createPanelPins()`), so every restart of the Host
 * or reload of the page starts from "nothing unpinned". The sidebar publishes
 * that store through its `sidebar` slot inject face (`setPinned` plus
 * `hooks.entryPins`), which this module uses to replay the saved choices after
 * the shell registers, and to write every later change back to `localStorage`.
 */
window.__ModuleLoader__.load({
  id: '@rzcdz/dsh-sidebar-pins-persist',
  factory() {
    /** Storage key holding the ids the user unpinned from the left sidebar. */
    const STORAGE_KEY = 'dsh.sidebar.panel-pins.unpinned.v1'

    /**
     * Read the saved unpinned ids.
     * @returns the saved list, or undefined when nothing was stored or the value is unusable.
     */
    function readSaved() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return undefined
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return undefined
        return parsed.filter(id => typeof id === 'string')
      } catch (error) {
        console.error('[sidebar-pins-persist] could not read the saved pin choices:', error)
        return undefined
      }
    }

    /**
     * Write the unpinned ids, skipping a write that would not change the stored value.
     * @param ids - the live unpinned ids.
     */
    function writeSaved(ids) {
      try {
        const next = JSON.stringify(ids)
        if (localStorage.getItem(STORAGE_KEY) === next) return
        localStorage.setItem(STORAGE_KEY, next)
      } catch (error) {
        console.error('[sidebar-pins-persist] could not save the pin choices:', error)
      }
    }

    /**
     * Find the sidebar shell's slot entry, whose inject face owns the pin store.
     * @param ctx - client root context carrying the slot registry.
     * @returns the entry, or undefined while the shell has not registered yet.
     */
    function findSidebarEntry(ctx) {
      for (const entry of ctx.slots.entriesOfSlot('sidebar')) {
        if (typeof entry.inject === 'function') return entry
      }
      return undefined
    }

    /**
     * Bind one sidebar registration: replay the saved choices into its fresh pin
     * store, then mirror every later change back to storage.
     * @param entry - the `sidebar` slot entry.
     * @returns the teardown that stops mirroring, or undefined when the entry carries no pin store.
     */
    function bindEntry(entry) {
      const face = entry.inject()
      const setPinned = face === null || face === undefined ? undefined : face.setPinned
      const pins = face === null || face === undefined || face.hooks === undefined ? undefined : face.hooks.entryPins
      if (typeof setPinned !== 'function' || pins === undefined) return undefined
      const saved = readSaved()
      if (saved !== undefined) {
        for (const id of saved) {
          try {
            setPinned(id, false)
          } catch (error) {
            console.error(`[sidebar-pins-persist] could not restore the unpinned panel "${id}":`, error)
          }
        }
      }
      writeSaved(pins.getSnapshot())
      return pins.subscribe(() => {
        try {
          writeSaved(pins.getSnapshot())
        } catch (error) {
          console.error('[sidebar-pins-persist] could not mirror the pin choices:', error)
        }
      })
    }

    return {
      inject: ['slots'],
      /**
       * Mirror the sidebar's pin choices across restarts.
       * @param ctx - client root context carrying the slot registry.
       */
      apply(ctx) {
        ctx.effect(() => {
          let bound
          let disposePins
          const reconcile = () => {
            const entry = findSidebarEntry(ctx)
            if (entry === undefined || entry === bound) return
            if (disposePins !== undefined) {
              disposePins()
              disposePins = undefined
            }
            bound = entry
            try {
              disposePins = bindEntry(entry)
            } catch (error) {
              console.error('[sidebar-pins-persist] could not attach to the sidebar pin store:', error)
            }
          }
          const unsubscribeSlots = ctx.slots.subscribe('sidebar', reconcile)
          reconcile()
          return () => {
            unsubscribeSlots()
            if (disposePins !== undefined) disposePins()
          }
        }, 'sidebar-pins-persist: mirror the panel pin choices')
      },
    }
  },
})
