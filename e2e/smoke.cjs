/**
 * End-to-end smoke test: the real app (main + preload + renderer) against the in-memory Disk in
 * fake-disk.cjs and a throw-away profile, so it never touches your account or your data folder.
 *
 *   npm run e2e                      # needs a display; prints PASS/FAIL per step, exit code 1 on failure
 *   E2E_SHOTS=/some/dir npm run e2e  # also saves screenshots of the main steps
 *
 * Run through `electron -r` (see package.json), i.e. this file is loaded before the app starts.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeTheme } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diya-e2e-'));
process.env.YADISK_USER_DATA = path.join(tmp, 'profile');
fs.mkdirSync(process.env.YADISK_USER_DATA, { recursive: true });
fs.writeFileSync(path.join(process.env.YADISK_USER_DATA, 'settings.json'), '{"language":"en"}');
const syncDir = path.join(tmp, 'sync');
fs.mkdirSync(syncDir);
const shots = process.env.E2E_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

require('./fake-disk.cjs');
const fake = globalThis.__fake;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};

// CI on Linux has no SUID sandbox helper; the switch is for the test run only.
if (process.env.E2E_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');

app.requestSingleInstanceLock = () => true; // a running copy of the app must not block the test

let mainWindowSeen = false;
app.on('browser-window-created', (_e, win) => {
  if (mainWindowSeen) return; // only the main window is driven
  mainWindowSeen = true;
  const run = code => win.webContents.executeJavaScript(code);
  const shot = async name => {
    if (shots)
      fs.writeFileSync(
        path.join(shots, `${name}.png`),
        (await win.webContents.capturePage()).toPNG()
      );
  };
  const helpers = `window.$ = {
    qa: s => [...document.querySelectorAll(s)],
    q: s => document.querySelector(s),
    text: (sel, t) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(t)),
    type: (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); },
    rows: () => [...document.querySelectorAll('tbody tr.row')].map(r => r.querySelector('.name-cell__text').textContent),
    tree: () => [...document.querySelectorAll('.tree .tree-item__label')].map(c => c.textContent),
  }; true`;
  let started = false;
  win.webContents.on('did-finish-load', async () => {
    if (started) return;
    started = true;
    try {
      await sleep(800);
      await run(helpers);

      // Sign in with a token through the real form.
      await run(`$.q('details').open = true; true`);
      await run(
        `$.type($.q('input[aria-label="OAuth token"]'), 'fake-token'); $.q('form button[type=submit]').click(); true`
      );
      await sleep(2000);
      await run(helpers);
      check(
        'sign-in with a token opens the file manager',
        (await run('$.tree()')).includes('Documents')
      );
      check('the root lists the Disk files', (await run('$.rows()')).includes('readme.md'));
      await shot('1-main');
      nativeTheme.themeSource = 'dark';
      await sleep(400);
      await shot('2-dark');
      nativeTheme.themeSource = 'light';

      // Navigate, make a folder.
      await run(`$.text('.tree .tree-item', 'Documents').click(); true`);
      await sleep(700);
      check('a click in the tree opens the folder', (await run('$.rows()')).includes('notes.txt'));
      await run(`$.text('.toolbar .btn', 'New folder').click(); true`);
      await sleep(300);
      await run(
        `$.type($.q('#prompt-input'), 'Archive 2026'); $.q('.modal form button[type=submit]').click(); true`
      );
      await sleep(900);
      check('New folder creates it on the Disk', fake.dirs.has('/Documents/Archive 2026'));

      // Delete with confirmation, restore from the trash.
      await run(
        `$.qa('tbody tr.row').find(r => r.dataset.path === '/Documents/notes.txt').click(); true`
      );
      await sleep(200);
      await run(
        `$.q('.table-wrap').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); true`
      );
      await sleep(300);
      await run(`$.q('.modal__foot .btn--primary').click(); true`);
      await sleep(900);
      check(
        'Delete moves the file to the Disk trash',
        !fake.files.has('/Documents/notes.txt') && fake.trash.size === 1
      );
      await run(`$.q('.tree [role=treeitem]:last-child').click(); true`);
      await sleep(700);
      await shot('3-trash');
      await run(`$.q('tbody tr.row').click(); true`);
      await sleep(200);
      await run(`$.text('.toolbar .btn', 'Restore').click(); true`);
      await sleep(900);
      check('Restore brings it back', fake.files.has('/Documents/notes.txt'));

      // Publishing is switched off.
      await run(`$.text('.tree .tree-item', 'Disk').click(); true`);
      await sleep(600);
      await run(`$.qa('tbody tr.row').find(r => r.dataset.path === '/readme.md').click(); true`);
      await sleep(200);
      check(
        'creating a public link is disabled',
        await run(`$.text('.toolbar .btn', 'Share').disabled`)
      );

      // Two-way sync against a real temporary folder.
      await run(`window.api.configureSync(${JSON.stringify(syncDir)}, '/Sync')`);
      await sleep(2500);
      check(
        'sync downloads Disk files',
        fs.existsSync(path.join(syncDir, 'from-cloud.txt')) &&
          fs.existsSync(path.join(syncDir, 'sub', 'deep.txt'))
      );
      fs.writeFileSync(path.join(syncDir, 'made-locally.txt'), 'local');
      // The engine leaves files written in the last 2 s for the next run; make this one look settled.
      const settled = new Date(Date.now() - 10_000);
      fs.utimesSync(path.join(syncDir, 'made-locally.txt'), settled, settled);
      await run('window.api.syncNow(); true');
      await sleep(2500);
      check('sync uploads local files', fake.files.has('/Sync/made-locally.txt'));
      check(
        'sync leaves no conflict copies',
        !fs.readdirSync(syncDir).some(n => /conflict copy|конфликтная/.test(n))
      );
      await run(`$.qa('.toolbar .btn--icon').at(-1).click(); true`);
      await sleep(500);
      await shot('4-settings');

      // Language switch: the page reloads in the other language.
      await run(`window.api.languageSet('ru')`);
      await new Promise(r => win.webContents.once('did-finish-load', r));
      await sleep(1200);
      check(
        'the interface switches to Russian',
        /Загрузить/.test(await run('document.body.innerText'))
      );
      await run(`window.api.languageSet('en')`);
    } catch (err) {
      check('the run completed', false, String(err));
    }
    const failed = results.filter(ok => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  });
});
