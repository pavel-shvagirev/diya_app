// Lints the project's YAML (workflows, issue forms, Dependabot): it must parse, keys must be
// unique, and lines stay within 100 columns like the rest of the repository. A line may be
// longer only if it holds a single unbreakable word (a URL, a commit hash).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { parseDocument } from 'yaml';

const MAX = 100;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(f => /\.ya?ml$/.test(f))
  .filter(f => !f.startsWith('node_modules/'));

let problems = 0;
const fail = (file, line, msg) => {
  problems++;
  console.error(`${file}:${line}: ${msg}`);
};

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // listed by git, deleted in the working tree
  }
  const doc = parseDocument(text, { uniqueKeys: true });
  for (const e of [...doc.errors, ...doc.warnings]) {
    fail(file, e.linePos?.[0]?.line ?? 1, e.message.split('\n')[0]);
  }
  text.split('\n').forEach((line, i) => {
    if ([...line].length <= MAX) return;
    const body = line.replace(/^\s*(-\s+)?([\w.-]+:\s+)?/, '');
    if (/\s/.test(body.replace(/\s+#.*$/, '').trim())) {
      fail(file, i + 1, `line is ${[...line].length} columns, the limit is ${MAX}`);
    }
  });
}

if (problems > 0) {
  console.error(`\n${problems} YAML problem(s) in ${files.length} file(s)`);
  process.exit(1);
}
console.log(`YAML ok: ${files.length} file(s)`);
