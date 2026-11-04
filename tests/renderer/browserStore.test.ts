import { beforeEach, describe, expect, it } from 'vitest';

import { selectVisible, useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { useErrorStore } from '../../src/renderer/store/errorStore.js';
import { dir, file, installApi, list } from './helpers.js';

const store = () => useBrowserStore.getState();

describe('browserStore', () => {
  let api: ReturnType<typeof installApi>;

  beforeEach(() => {
    api = installApi();
    useBrowserStore.setState(useBrowserStore.getInitialState(), true);
    useErrorStore.getState().clearErrors();
  });

  it('opens a folder: entries, tree node, history and expanded ancestors', async () => {
    api.listFiles.mockResolvedValue(
      list([dir('Sub', '/Docs'), file('a.txt', { path: '/Docs/a.txt' })])
    );
    await store().openFolder('/Docs');
    const s = store();
    expect(s.view).toEqual({ kind: 'folder', path: '/Docs' });
    expect(s.entries.map(e => e.name)).toEqual(['Sub', 'a.txt']);
    expect(s.tree['/Docs']).toMatchObject({ loaded: true, dirs: ['/Docs/Sub'] });
    expect(s.expanded['/Docs'] && s.expanded['/']).toBe(true);
    expect(s.history.at(-1)).toEqual({ kind: 'folder', path: '/Docs' });
  });

  it('reports a load error and clears the listing', async () => {
    api.listFiles.mockRejectedValue(new Error('404: not found'));
    await store().openFolder('/Missing');
    expect(store().error).toBe('404: not found');
    expect(store().entries).toEqual([]);
    expect(store().loading).toBe(false);
  });

  it('ignores a stale response when the user navigated on', async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    api.listFiles
      .mockReturnValueOnce(new Promise(r => (releaseFirst = r)))
      .mockResolvedValue(list([file('fresh.txt')]));
    const slow = store().openFolder('/Slow');
    await store().openFolder('/Fast');
    releaseFirst(list([file('stale.txt')]));
    await slow;
    expect(store().entries.map(e => e.name)).toEqual(['fresh.txt']);
    expect(store().view).toEqual({ kind: 'folder', path: '/Fast' });
  });

  it('back / forward / up walk the history', async () => {
    await store().openFolder('/a');
    await store().openFolder('/a/b');
    await store().up();
    expect(store().view).toEqual({ kind: 'folder', path: '/a' });
    await store().back();
    expect(store().view).toEqual({ kind: 'folder', path: '/a/b' });
    await store().forward();
    expect(store().view).toEqual({ kind: 'folder', path: '/a' });
  });

  it('trash is a separate view with its own listing', async () => {
    api.getTrashList.mockResolvedValue(list([file('old.txt', { path: '/old.txt_1' })]));
    await store().openTrash();
    expect(store().view).toEqual({ kind: 'trash' });
    expect(store().entries.map(e => e.path)).toEqual(['/old.txt_1']);
  });

  describe('folders inside the trash', () => {
    beforeEach(() => {
      api.getTrashList.mockImplementation(async (p?: string) =>
        list(
          p === '/x_1'
            ? [file('in.txt', { path: '/x_1/in.txt' }), dir('sub', '/x_1')]
            : p === '/x_1/sub'
              ? [file('deep.txt', { path: '/x_1/sub/deep.txt' })]
              : [dir('x_1')]
        )
      );
    });

    it('opens a folder of the trash and keeps its path in the view', async () => {
      await store().openTrash();
      await store().openTrash({ path: '/x_1' });
      expect(store().view).toEqual({ kind: 'trash', path: '/x_1' });
      expect(api.getTrashList).toHaveBeenLastCalledWith('/x_1');
      expect(store().entries.map(e => e.path)).toEqual(['/x_1/in.txt', '/x_1/sub']);
    });

    it('up goes to the parent folder, then to the root of the trash, then stays', async () => {
      await store().openTrash({ path: '/x_1/sub' });
      await store().up();
      expect(store().view).toEqual({ kind: 'trash', path: '/x_1' });
      await store().up();
      expect(store().view).toEqual({ kind: 'trash' });
      expect(api.getTrashList).toHaveBeenLastCalledWith();
      api.getTrashList.mockClear();
      await store().up();
      expect(store().view).toEqual({ kind: 'trash' });
      expect(api.getTrashList).not.toHaveBeenCalled();
    });

    it('back, forward and refresh return to the same folder of the trash', async () => {
      await store().openTrash();
      await store().openTrash({ path: '/x_1' });
      await store().back();
      expect(store().view).toEqual({ kind: 'trash' });
      await store().forward();
      expect(store().view).toEqual({ kind: 'trash', path: '/x_1' });
      api.getTrashList.mockClear();
      await store().refresh();
      expect(api.getTrashList).toHaveBeenCalledWith('/x_1');
    });

    it('restoring under a new name passes the name on; without one the call is as before', async () => {
      await store().openTrash();
      await store().restoreEntries(['/x_1'], 'new.txt');
      expect(api.restoreFromTrash).toHaveBeenCalledWith('/x_1', 'new.txt');
      await store().restoreEntries(['/x_1']);
      expect(api.restoreFromTrash).toHaveBeenLastCalledWith('/x_1');
    });
  });

  describe('selection', () => {
    beforeEach(async () => {
      api.listFiles.mockResolvedValue(list([file('a'), file('b'), file('c'), file('d')]));
      await store().openFolder('/');
    });
    it('replace / toggle / range', () => {
      store().select('/a', 'replace');
      store().select('/c', 'toggle');
      expect(store().selection).toEqual(['/a', '/c']);
      store().select('/b', 'replace');
      store().select('/d', 'range');
      expect(store().selection).toEqual(['/b', '/c', '/d']);
    });
    it('selectAll respects the filter, clear empties', () => {
      store().setFilter('a');
      store().selectAll();
      expect(store().selection).toEqual(['/a']);
      store().clearSelection();
      expect(store().selection).toEqual([]);
    });
    it('navigating clears the selection and the filter', async () => {
      store().select('/a', 'replace');
      store().setFilter('x');
      await store().openFolder('/other');
      expect(store().selection).toEqual([]);
      expect(store().filter).toBe('');
    });
  });

  it('setSort toggles direction on the same column and selectVisible applies it', async () => {
    api.listFiles.mockResolvedValue(list([file('b', { size: 1 }), file('a', { size: 9 })]));
    await store().openFolder('/');
    store().setSort('size');
    expect(selectVisible(store()).map(e => e.name)).toEqual(['b', 'a']);
    store().setSort('size');
    expect(selectVisible(store()).map(e => e.name)).toEqual(['a', 'b']);
  });

  describe('operations', () => {
    beforeEach(async () => {
      api.listFiles.mockResolvedValue(list([file('a.txt', { path: '/Docs/a.txt' })]));
      await store().openFolder('/Docs');
      api.listFiles.mockClear();
    });

    it('createFolder makes it in the current folder and re-reads the listing', async () => {
      await store().createFolder('  New  ');
      expect(api.mkdir).toHaveBeenCalledWith('/Docs/New');
      expect(api.listFiles).toHaveBeenCalledWith('/Docs');
    });

    it('rename moves the entry within its parent', async () => {
      await store().renameEntry('/Docs/a.txt', 'b.txt');
      expect(api.moveFile).toHaveBeenCalledWith('/Docs/a.txt', '/Docs/b.txt');
    });

    it('delete passes the permanently flag per item', async () => {
      await store().deleteEntries(['/Docs/a.txt', '/Docs/b.txt'], false);
      expect(api.deleteFile.mock.calls).toEqual([
        ['/Docs/a.txt', false],
        ['/Docs/b.txt', false],
      ]);
    });

    it('a failing operation is reported and the listing is still refreshed', async () => {
      api.deleteFile.mockRejectedValue(new Error('403: forbidden'));
      await store().deleteEntries(['/Docs/a.txt']);
      expect(useErrorStore.getState().errors.map(e => e.message)).toEqual(['403: forbidden']);
      expect(api.listFiles).toHaveBeenCalledWith('/Docs');
    });

    it('move skips no-ops: same parent and into itself', async () => {
      await store().moveEntries(['/Docs/a.txt'], '/Docs');
      await store().moveEntries(['/Docs'], '/Docs/Sub');
      expect(api.moveFile).not.toHaveBeenCalled();
      await store().moveEntries(['/Docs/a.txt'], '/Other');
      expect(api.moveFile).toHaveBeenCalledWith('/Docs/a.txt', '/Other/a.txt');
    });

    it('copying into the same folder gets a different name', async () => {
      await store().copyEntries(['/Docs/a.txt'], '/Docs');
      await store().copyEntries(['/Docs/a.txt'], '/Other');
      expect(api.copyFile.mock.calls[0][1]).not.toBe('/Docs/a.txt');
      expect(api.copyFile.mock.calls[1]).toEqual(['/Docs/a.txt', '/Other/a.txt']);
    });

    it('upload targets the current folder and refreshes', async () => {
      await store().uploadFiles(['/local/x']);
      expect(api.uploadFiles).toHaveBeenCalledWith('/Docs', ['/local/x']);
      expect(api.listFiles).toHaveBeenCalledWith('/Docs');
    });

    it('share returns the public url; failure returns null and reports', async () => {
      expect(await store().shareEntry('/Docs/a.txt')).toBe('https://yadi.sk/d/1');
      api.publish.mockRejectedValue(new Error('boom'));
      expect(await store().shareEntry('/Docs/a.txt')).toBeNull();
      expect(useErrorStore.getState().errors).toHaveLength(1);
    });

    it('restore re-reads the trash view', async () => {
      await store().openTrash();
      api.getTrashList.mockClear();
      await store().restoreEntries(['/x_1']);
      expect(api.restoreFromTrash).toHaveBeenCalledWith('/x_1');
      expect(api.getTrashList).toHaveBeenCalled();
    });
  });

  it('tree: toggleExpand loads children lazily, once', async () => {
    api.listFiles.mockResolvedValue(list([dir('Kid', '/Docs')]));
    await store().toggleExpand('/Docs');
    await store().toggleExpand('/Docs'); // collapse
    await store().toggleExpand('/Docs'); // expand again: no second request
    expect(api.listFiles).toHaveBeenCalledTimes(1);
    expect(store().tree['/Docs']?.dirs).toEqual(['/Docs/Kid']);
  });

  it('quota is loaded into the store', async () => {
    await store().loadQuota();
    expect(store().quota).toEqual({ used: 25, total: 100, trash: 0 });
  });
});
