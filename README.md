# Sidebar pin memory

A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin bundle that
remembers which launchers you unpinned from the left sidebar and replays that
choice after DSH restarts.

Unpin a panel such as **Remote window** once, and it stays inside **More**
instead of coming back to the sidebar on the next start.

## Why the shipped behaviour resets

`@deepseek-ai/dsh-client-ui-sidebar` builds its pin list with an in-memory
snapshot store and no `persist` option, so every Host restart or page reload
starts from "nothing unpinned". The sidebar publishes that store through its
`sidebar` slot inject face (`setPinned` plus `hooks.entryPins`), which is the
only public surface over it.

## What this bundle does

`client.js` waits for the shell's `sidebar` slot registration, writes every
saved id back through `setPinned(id, false)`, then mirrors later changes into
`localStorage` under `dsh.sidebar.panel-pins.unpinned.v1`. It re-binds when the
shell registers again, so an HMR reload of the sidebar restores the choices too.

The Host half is inert: it only keeps the package visible to the Client module
scan.

## Install

DSH needs the bundle in the profile that should load it.

**From the DSH UI** — open **Plugins** → **Add plugin**, then enter the
repository URL:

```text
https://github.com/rzcdz/dsh-sidebar-pins-persist
```

Accepted spec forms include `rzcdz/dsh-sidebar-pins-persist`,
`github:rzcdz/dsh-sidebar-pins-persist` and a full `https://github.com/...` URL.

**From an agent session** — ask DSH to run `plugin_manager` with
`action: install_bundle` and that same URL as `target`.

**From a local clone** — point **Add plugin** at the clone's absolute path.

The bundle is enabled by default after installation. Restart or reload the page
and unpin something to confirm the choice survives.

Requirements: a DSH build that ships `@deepseek-ai/dsh-client-ui-sidebar`. No
Node package is installed on the Host beyond DSH itself.

## Limits

- Choices are per browser profile, not per Session or Workspace.
- The sidebar's fixed entry (**Plugins**) can never be unpinned, before or after
  this bundle.
- Removing the bundle leaves the stored key in `localStorage`; it is inert
  without the Client half.

## Removing

Disable or remove the bundle from **Plugins**. To clear the stored choices as
well, delete the `dsh.sidebar.panel-pins.unpinned.v1` key from the page's
`localStorage`.

## 中文说明

DSH 插件：记住你从左侧边栏取消固定的面板，重启后自动恢复，因此「远程窗口」
这类面板会留在「更多」菜单里，而不是又回到侧边栏。

安装：**插件** → **添加插件**，填入 `https://github.com/rzcdz/dsh-sidebar-pins-persist`。
取消固定后刷新页面验证。记录按浏览器 profile 保存，不区分会话或工作区；
侧边栏固定的「插件」入口无法取消。

## License

MIT
