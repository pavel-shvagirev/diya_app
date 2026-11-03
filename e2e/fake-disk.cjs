// In-memory stand-in for the Yandex Disk REST API, for end-to-end runs without an account.
// Loaded with `electron -r`, it replaces global fetch in the main process; shapes follow the
// official documentation (_embedded.items, disk:/ paths, href links).
const crypto = require('crypto');
const dirs = new Set(['/', '/Documents', '/Documents/Reports', '/Photos', '/Music', '/Sync']);
const files = new Map(); // path -> {data:Buffer, modified}
const trash = new Map(); // id -> {name, data|null, type}
let clock = 1;
const stamp = () => new Date(Date.UTC(2026, 9, 1, 12, 0, clock++)).toISOString();
const put = (p, text) => files.set(p, { data: Buffer.from(text), modified: stamp() });
put('/readme.md', '# hello');
put('/Documents/notes.txt', 'some notes');
put('/Documents/Reports/q1.pdf', 'pdf-bytes-'.repeat(100));
put('/Photos/a.jpg', 'jpg1');
put('/Photos/b.png', 'png22');
put('/Sync/from-cloud.txt', 'cloud file');
put('/Sync/sub/deep.txt', 'deep');
dirs.add('/Sync/sub');

const norm = p =>
  '/' +
  (p || '/')
    .replace(/^(disk|trash):/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
const parent = p => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
const name = p => p.slice(p.lastIndexOf('/') + 1);
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const rsrc = p =>
  dirs.has(p)
    ? { type: 'dir', name: name(p), path: 'disk:' + p, modified: stamp() }
    : {
        type: 'file',
        name: name(p),
        path: 'disk:' + p,
        size: files.get(p).data.length,
        modified: files.get(p).modified,
        public_url: files.get(p).pub,
        md5: md5(files.get(p).data),
        mime_type: 'application/octet-stream',
      };
const children = d => [...dirs, ...files.keys()].filter(p => p !== '/' && parent(p) === d).sort();
const J = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const log = [];
globalThis.__fakeLog = log;
globalThis.__fake = { dirs, files, trash, log };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  log.push(`${method} ${url.pathname}${url.search.slice(0, 80)}`);
  const q = k => url.searchParams.get(k);
  if (url.host === 'uploader.test') {
    const chunks = [];
    for await (const c of init.body) chunks.push(c);
    put(norm(q('path')), Buffer.concat(chunks).toString('latin1'));
    files.get(norm(q('path'))).data = Buffer.concat(chunks);
    return J(201);
  }
  if (url.host === 'downloader.test') {
    if (globalThis.__fake.slow) await new Promise(r => setTimeout(r, 450));
  }
  if (url.host === 'downloader.test')
    return new Response(files.get(norm(q('path'))).data, {
      status: 200,
      headers: { 'content-length': String(files.get(norm(q('path'))).data.length) },
    });
  if (url.host !== 'cloud-api.yandex.net') throw new Error('unexpected host ' + url.host);
  const route = url.pathname.replace('/v1/disk', '') || '/';
  const p = norm(q('path'));
  if (route === '/')
    return J(200, {
      total_space: 15 * 1024 ** 3,
      used_space: 4 * 1024 ** 3,
      trash_size: 12,
      type: 'disk',
    });
  if (route === '/resources' && method === 'GET') {
    if (!dirs.has(p) && !files.has(p))
      return J(404, { message: 'Resource not found', error: 'DiskNotFoundError' });
    if (files.has(p)) return J(200, rsrc(p));
    const lim = Number(q('limit') ?? 20),
      off = Number(q('offset') ?? 0);
    const all = children(p);
    return J(200, {
      ...rsrc(p),
      _embedded: {
        path: 'disk:' + p,
        limit: lim,
        offset: off,
        total: all.length,
        items: lim === 0 ? [] : all.slice(off, off + lim).map(rsrc),
      },
    });
  }
  if (route === '/resources' && method === 'PUT') {
    if (dirs.has(p)) return J(409, { message: 'exists' });
    dirs.add(p);
    return J(201, { href: 'x' });
  }
  if (route === '/resources' && method === 'DELETE') {
    const id = Math.random().toString(36).slice(2, 8);
    if (files.has(p)) {
      trash.set(name(p) + '_' + id, { type: 'file', data: files.get(p).data, orig: p });
      files.delete(p);
    } else if (dirs.has(p)) {
      trash.set(name(p) + '_' + id, { type: 'dir', orig: p });
      for (const k of [...files.keys()]) if (k.startsWith(p + '/')) files.delete(k);
      for (const k of [...dirs]) if (k === p || k.startsWith(p + '/')) dirs.delete(k);
    }
    return J(204);
  }
  if (route === '/resources/upload')
    return J(200, {
      href: `https://uploader.test/put?path=${encodeURIComponent(p)}`,
      method: 'PUT',
    });
  if (route === '/resources/download')
    return J(200, { href: `https://downloader.test/get?path=${encodeURIComponent(p)}` });
  if (route === '/resources/move' || route === '/resources/copy') {
    const from = norm(q('from'));
    const mv = route.endsWith('move');
    if (files.has(from)) {
      files.set(p, { ...files.get(from), modified: stamp() });
      if (mv) files.delete(from);
    } else if (dirs.has(from)) {
      dirs.add(p);
      if (mv) dirs.delete(from);
    } else return J(404, { message: 'not found' });
    return J(201, { href: 'x' });
  }
  if (route === '/resources/publish') {
    files.get(p).pub = 'https://yadi.sk/d/' + md5(p).slice(0, 8);
    return J(200, { href: 'x' });
  }
  if (route === '/trash/resources' && method === 'GET') {
    const items = [...trash].map(([id, v]) => ({
      type: v.type,
      name: id.replace(/_[^_]+$/, ''),
      path: 'trash:/' + id,
      size: v.data?.length,
    }));
    return J(200, { _embedded: { items, total: items.length } });
  }
  if (route === '/trash/resources' && method === 'DELETE') {
    if (q('path')) trash.delete(norm(q('path')).slice(1));
    else trash.clear();
    return J(204);
  }
  if (route === '/trash/resources/restore') {
    const id = norm(q('path')).slice(1);
    const v = trash.get(id);
    if (v.type === 'file') files.set(v.orig, { data: v.data, modified: stamp() });
    else dirs.add(v.orig);
    trash.delete(id);
    return J(201, { href: 'x' });
  }
  return J(404, { message: 'fake: no route ' + method + ' ' + route });
};
