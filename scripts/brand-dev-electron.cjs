#!/usr/bin/env node
/**
 * macOS shows the name from the app bundle's Info.plist in the menu bar and the Dock. A source
 * checkout runs the stock Electron binary, which says "Electron"; this gives it the product
 * name. Development only: packaged builds already carry the right name. Safe to run repeatedly.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'Diya';
if (process.platform !== 'darwin') process.exit(0);

const plist = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist'
);
if (!fs.existsSync(plist)) process.exit(0);

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${NAME}`, plist], {
      stdio: 'ignore',
    });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${NAME}`, plist], {
      stdio: 'ignore',
    });
  }
}

// Launch Services caches the name it read the first time; touch the bundle and re-register it so
// the Dock label and the menu bar pick up the new one at the next launch.
const app = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');
const now = new Date();
fs.utimesSync(app, now, now);
try {
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', app],
    { stdio: 'ignore' }
  );
} catch {
  // not fatal: the name still changes once the cache refreshes
}
