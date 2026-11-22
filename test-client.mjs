/**
 * Standalone harness for the sidebar pin persistence Client module.
 *
 * It boots `client.js` the way the browser module system does (a
 * `window.__ModuleLoader__.load` registration), then drives the slot registry
 * and the sidebar's in-memory pin store through the same contract the shipped
 * sidebar exposes: `entriesOfSlot('sidebar')`, `subscribe('sidebar', ...)`, and
 * an inject face of `{ setPinned, hooks: { entryPins } }`.
 *
 * Run: node test-client.mjs
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

/** A minimal `localStorage` that survives across simulated restarts. */
function createStorage(backing = new Map()) {
  return {
    backing,
    getItem: key => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => { backing.set(key, String(value)) },
    removeItem: key => { backing.delete(key) },
  }
}

/** A snapshot store shaped like `createPanelPins()` in the shipped sidebar. */
function createPanelPins() {
  const FIXED_PANEL_ID = 'plugins'
  let unpinned = []
  const listeners = new Set()
  const notify = () => { for (const fn of [...listeners]) fn() }
  return {
    unpinned: {
      getSnapshot: () => unpinned,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    setPinned: (id, pinned) => {
      if (id === FIXED_PANEL_ID || pinned !== unpinned.includes(id)) return
      unpinned = pinned ? unpinned.filter(entry => entry !== id) : [...unpinned, id]
      notify()
    },
  }
}

/** Boot one module instance, as the page does on load or on an HMR replacement. */
function boot(storage) {
  let registration
  globalThis.localStorage = storage
  globalThis.window = { __ModuleLoader__: { load: entry => { registration = entry } } }
  // Fresh module scope per boot: re-evaluate the bundle source.
  new Function('window', source)(globalThis.window)
  assert.equal(registration.id, '@rzcdz/dsh-sidebar-pins-persist')
  return registration.factory()
}

/** A slot registry double carrying one tab of client state. */
function createSlots() {
  const entries = new Map()
  const listeners = new Map()
  return {
    entriesOfSlot: key => entries.get(key) ?? [],
    subscribe: (key, fn) => {
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key).add(fn)
      return () => { listeners.get(key)?.delete(fn) }
    },
    /** Register the sidebar shell exactly as ui-sidebar does. */
    registerSidebar(component, inject) {
      const entry = { component, options: {}, inject }
      entries.set('sidebar', [entry])
      for (const fn of [...(listeners.get('sidebar') ?? [])]) fn()
      return entry
    },
  }
}

function createCtx(slots) {
  const disposers = []
  return {
    slots,
    effect(factory, _label) {
      const dispose = factory()
      disposers.push(dispose)
      return () => { disposers.push(dispose) }
    },
    disposeAll() { for (const dispose of disposers.splice(0)) if (dispose) dispose() },
  }
}

const tests = []

// 1. An unpin choice is replayed after a restart.
tests.push(['restores an unpinned panel after a restart', () => {
  const storage = createStorage()
  const pins = createPanelPins()

  const first = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  first.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))

  pins.setPinned('remote-window', false)
  assert.deepEqual(pins.unpinned.getSnapshot(), ['remote-window'])
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '["remote-window"]')
  ctx.disposeAll()
}])

// 2. A fresh boot with the same storage puts the panel back in More.
tests.push(['a restart adopts the saved choice into a fresh store', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', '["remote-window","xd-pool"]')

  const pins = createPanelPins()
  const second = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  second.apply(ctx)
  assert.deepEqual(pins.unpinned.getSnapshot(), [], 'the store starts empty, like the shipped one')
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  assert.deepEqual(pins.unpinned.getSnapshot().sort(), ['remote-window', 'xd-pool'])
  ctx.disposeAll()
}])

// 3. Re-pinning removes the id from storage too.
tests.push(['re-pinning a panel clears its saved choice', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', '["remote-window"]')
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  assert.deepEqual(pins.unpinned.getSnapshot(), ['remote-window'])

  pins.setPinned('remote-window', true)
  assert.deepEqual(pins.unpinned.getSnapshot(), [])
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '[]')
  ctx.disposeAll()
}])

// 4. The fixed Plugins entry can never be unpinned, before or after this bundle.
tests.push(['the fixed Plugins panel stays pinned', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', '["plugins","remote-window"]')
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  assert.deepEqual(pins.unpinned.getSnapshot(), ['remote-window'])
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '["remote-window"]')
  ctx.disposeAll()
}])

// 5. An HMR replacement of the sidebar re-binds without duplicating state.
tests.push(['a re-registered sidebar re-binds and keeps the saved choice', () => {
  const storage = createStorage()
  const firstPins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)

  slots.registerSidebar(function SidebarA() {}, () => ({ setPinned: firstPins.setPinned, hooks: { entryPins: firstPins.unpinned } }))
  firstPins.setPinned('remote-window', false)

  const secondPins = createPanelPins()
  slots.registerSidebar(function SidebarB() {}, () => ({ setPinned: secondPins.setPinned, hooks: { entryPins: secondPins.unpinned } }))
  assert.deepEqual(secondPins.unpinned.getSnapshot(), ['remote-window'])
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '["remote-window"]')
  ctx.disposeAll()
}])

// 6. Corrupt saved data is ignored instead of breaking the sidebar.
tests.push(['unusable saved data is ignored', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', 'not json')
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  assert.deepEqual(pins.unpinned.getSnapshot(), [])
  ctx.disposeAll()
}])

// 7. A blocked storage still leaves the sidebar usable.
tests.push(['a storage that throws does not break the sidebar', () => {
  const storage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => {},
  }
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  pins.setPinned('remote-window', false)
  assert.deepEqual(pins.unpinned.getSnapshot(), ['remote-window'])
  ctx.disposeAll()
}])

// 8. Sandboxed slots inject with no arguments; the face must still resolve.
tests.push(['the sidebar inject face is read with no arguments', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', '["remote-window"]')
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  let seenArgs
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, (...args) => {
    seenArgs = args
    return { setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }
  })
  assert.deepEqual(seenArgs, [], 'root-scope inject gets no positional arguments')
  assert.deepEqual(pins.unpinned.getSnapshot(), ['remote-window'])
  ctx.disposeAll()
}])

// 9. Registration order does not matter: the sidebar may come first.
tests.push(['a sidebar registered before the module still restores', () => {
  const storage = createStorage()
  storage.setItem('dsh.sidebar.panel-pins.unpinned.v1', '["xd-pool"]')
  const pins = createPanelPins()
  const slots = createSlots()
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))

  const module = boot(storage)
  const ctx = createCtx(slots)
  module.apply(ctx)
  assert.deepEqual(pins.unpinned.getSnapshot(), ['xd-pool'])
  ctx.disposeAll()
}])

// 10. Unload stops mirroring, so a later change is not written by a dead module.
tests.push(['disposing the module stops mirroring changes', () => {
  const storage = createStorage()
  const pins = createPanelPins()
  const module = boot(storage)
  const slots = createSlots()
  const ctx = createCtx(slots)
  module.apply(ctx)
  slots.registerSidebar(function Sidebar() {}, () => ({ setPinned: pins.setPinned, hooks: { entryPins: pins.unpinned } }))
  pins.setPinned('remote-window', false)
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '["remote-window"]')

  ctx.disposeAll()
  pins.setPinned('xd-pool', false)
  assert.equal(storage.getItem('dsh.sidebar.panel-pins.unpinned.v1'), '["remote-window"]',
    'the unloaded module must not keep writing')
}])

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}`)
    console.log(`      ${error.message}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exitCode = failed === 0 ? 0 : 1
