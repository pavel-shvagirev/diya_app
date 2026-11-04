// @vitest-environment node
// Real fetch against a real socket server (see transfer-http.test.ts for why).
import { createServer, type Server } from 'net';
import type { AddressInfo } from 'net';

import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureNetwork } from '../../src/main/network.js';

// nodejs/undici#5360: a response of about 64 KiB whose reader is slow, followed by the server
// closing the connection, crashed the bundled undici with `assert(!this.paused)`. Vitest runs on
// a Node that may already have the fix, so this pins that the replacement dispatcher is wired in
// and survives the scenario; the crash itself was reproduced with the Electron binary.
let server: Server;
let port: number;
const original = getGlobalDispatcher();

beforeAll(async () => {
  const body = Buffer.alloc(64 * 1024, 0x61);
  server = createServer(sock => {
    sock.once('data', () => {
      sock.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`);
      sock.write(body);
      sock.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  setGlobalDispatcher(original);
  server.close();
});

describe('configureNetwork', () => {
  it('replaces the global dispatcher', () => {
    configureNetwork();
    expect(getGlobalDispatcher()).not.toBe(original);
  });

  it('reads a body that is consumed late after the server closed the connection', async () => {
    configureNetwork();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    await new Promise(r => setTimeout(r, 300));
    expect((await res.arrayBuffer()).byteLength).toBe(64 * 1024);
  });
});
