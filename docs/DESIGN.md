# Design system

Visual contract for the renderer: flat, compact, sharp. Plain CSS custom properties, no UI
framework, no JS theming engine.

## Principles

1. **Dense, not roomy.** 13 px base text, 22 px rows, 24 px controls, icon-only toolbar buttons
   with hints. Small elements carry the information; whitespace is a separator, not decoration.
2. **Sharp.** 2 px control radius (3 px for floating panels), 1 px hairlines, no gradients, one
   small popup shadow.
3. **Tokens, not literals.** Components use `var(--ui-*)`; raw hex/rgba in `.tsx` is a bug.
   Colours live only in `src/renderer/styles/themes.css`.
4. **System theme by default.** `color-scheme: light dark` + `light-dark()` follow the OS live
   without JS. `data-theme="light|dark"` on `<html>` is an explicit override (`themeStore`).
5. **Numbers in monospace.** Dates, sizes and paths use JetBrains Mono (bundled, SIL OFL) so
   columns align; UI text uses the system font.
6. **Accessible.** WCAG AA contrast in both themes, a visible 1 px `:focus-visible` outline,
   every icon-only button has a text label for screen readers (visually hidden).

## Tokens

| Token                               | Light                 | Dark                  | Use             |
| ----------------------------------- | --------------------- | --------------------- | --------------- |
| `--ui-bg`                           | `#ffffff`             | `#0d1117`             | window, content |
| `--ui-bg-card`                      | `#f6f8fa`             | `#010409`             | chrome, panels  |
| `--ui-bg-subtle`                    | `#f6f6f6`             | `#1a1e24`             | soft fills      |
| `--ui-text-primary`                 | `#1f2328`             | `#e6edf3`             | body text       |
| `--ui-text-secondary` / `-tertiary` | `#656d76` / `#6e7781` | `#9198a1` / `#7d8590` | hierarchy       |
| `--ui-stroke`                       | `#d0d7de`             | `#30363d`             | hairlines       |
| `--ui-accent` / `--ui-accent-fg`    | `#0053fd` / `#fff`    | `#4a84fe` / `#161616` | primary action  |
| `--ui-accent-bg`                    | `#e3edff`             | `#17243a`             | selected rows   |
| `--ui-danger`                       | `#cf222e`             | `#f85149`             | errors          |
| `--ui-success` / `--ui-warning`     | `#1a7f37` / `#9a6700` | `#3fb950` / `#d29922` | status          |
| `--ui-radius`                       | `2px`                 |                       | controls        |

## Layout

- **Toolbar:** back / forward / up, path bar (clickable breadcrumbs), name filter, actions
  (Upload, New folder, Download, Share, Delete; Restore / Delete forever / Empty trash in the
  trash view), refresh, settings.
- **Left: folder tree** (lazy, keyboard-navigable, drop target for moving items; the synced
  folder carries a badge; Trash is the last node). Width is draggable.
- **Right: table** (Name, Modified, Size, Type; sortable; folders first; multi-select with
  click / Ctrl / Shift; context menu; double-click opens a folder or downloads a file; OS files
  can be dropped to upload; rows can be dragged onto tree folders).
- **Status bar:** counts, transfers (popover with per-file progress), sync state with live
  progress (opens Settings), quota.
- **Settings** (modal): sync folders, on/off, sync now, status; appearance (theme, language);
  account.
- **Hints:** every action button has a `title`; a disabled one says what is missing.
- **Native menus:** only items that do something. App menu = Settings, Log, Edit, View
  (Reload / DevTools only in development), Window, Quit ("Завершить" in Russian). Tray = Open,
  Pause/Resume sync (or "Set up sync…"), Settings, Quit. Labels follow the interface language
  (Settings → Language, else the OS).
- **Closing vs quitting:** Cmd/Ctrl+W closes a window and the app stays in the tray; Cmd/Ctrl+Q
  shows a hint and needs a second press within 3 s; the menu and tray "Quit" items are immediate
  (the shortcut is handled in the window, so the item shows none).
- **Dialogs** opened from other dialogs (folder picker from Settings) render in `.dialog-layer`
  above them; Esc closes only the topmost.
- **Sign-in screen:** one primary button once the Client ID and secret are saved; code,
  countdown and cancel while waiting, with what to do next; "Setup and token sign-in" (steps to
  create your own application, Client ID + secret, paste a token), open until both are set.
  Links to Yandex OAuth follow the interface language (.ru / .com).
- **Keyboard (table):** arrows, Shift+arrows, Home/End, Ctrl/Cmd+A, Enter (open), F2 (rename),
  Delete (to trash), Esc (clear selection).

## Rules

- Controls: 2 px radius, 1 px `--ui-stroke` border, hover fill via `color-mix`.
- Floating panels: `--shadow-popup` plus a hairline.
- One primary (accent-filled) action per view.
- No hard-coded `#fff`, `white`, `#666` in components.
