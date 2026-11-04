/**
 * Network layer of the main process.
 *
 * Electron 45 bundles undici 7.30, whose HTTP/1 client throws an uncatchable
 * `AssertionError: assert(!this.paused)` when the server closes the connection while the reader
 * is still behind (nodejs/undici#5360, fixed in undici 8.6). On a slow disk a download hits it
 * and the whole app dies with "A JavaScript error occurred in the main process". The global
 * `fetch` stays Node's own; only its connection layer is replaced by the fixed one.
 *
 * @module network
 */
import { Agent, setGlobalDispatcher } from 'undici';

/** Route every global `fetch` through the fixed undici. Call once, before any request. */
export function configureNetwork(): void {
  // HTTP/1.1 only, as the bundled undici does: undici 8 would otherwise offer HTTP/2.
  setGlobalDispatcher(new Agent({ allowH2: false }));
}
