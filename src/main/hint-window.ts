/**
 * A small, non-activating pop-up hint ("press Cmd+Q again to quit") that appears even
 * when every app window is closed and the app only lives in the tray.
 *
 * @module hint-window
 */
import { BrowserWindow, screen } from 'electron';

let hint: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function showHint(text: string, ms = 3000): void {
  hideHint();
  const w = 360;
  const h = 64;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  hint = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + workArea.height * 0.72),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  hint.setIgnoreMouseEvents(true);
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{color-scheme:light dark}
    html,body{margin:0;height:100%;background:transparent;overflow:hidden}
    body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:0 16px;
      font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;
      background:light-dark(#ffffff,#161b22);color:light-dark(#1f2328,#e6edf3);
      border:1px solid light-dark(#d0d7de,#30363d);border-radius:8px}
  </style><body>${escapeHtml(text)}</body>`;
  void hint.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  hint.once('ready-to-show', () => hint?.showInactive());
  timer = setTimeout(hideHint, ms);
}

export function hideHint(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (hint && !hint.isDestroyed()) hint.destroy();
  hint = null;
}
