/**
 * Adapter exposing the Yandex.Disk client as the sync engine's RemoteStorage.
 *
 * @module remote-storage
 */
import { downloadFile, uploadFile } from './transfer.js';
import type { RemoteEntry, RemoteStorage } from './sync-engine.js';
import type { YandexDiskClient } from './yandex-api.js';
import type { FileMetadata } from '../shared/types.js';

function toEntry(m: FileMetadata): RemoteEntry {
  return {
    path: m.path,
    name: m.name,
    isDir: m.type === 'dir',
    size: m.size ?? 0,
    modified: m.modified ?? '',
    md5: m.md5,
  };
}

export class YandexRemote implements RemoteStorage {
  constructor(private readonly client: YandexDiskClient) {}

  async list(remoteDir: string): Promise<RemoteEntry[]> {
    return (await this.client.listFiles(remoteDir)).items.map(toEntry);
  }

  async stat(remotePath: string): Promise<RemoteEntry> {
    return toEntry(await this.client.getMeta(remotePath));
  }

  mkdir(remotePath: string): Promise<void> {
    return this.client.mkdir(remotePath);
  }

  async upload(
    localPath: string,
    remotePath: string,
    overwrite: boolean,
    onProgress: (done: number, total: number) => void
  ): Promise<void> {
    // 'accepted' (202) is a success too: the sync engine copes with a file the Disk shows late.
    await uploadFile(this.client, localPath, remotePath, overwrite, onProgress);
  }

  download(
    remotePath: string,
    localPath: string,
    onProgress: (done: number, total: number) => void,
    mtime: Date,
    expected?: { size?: number; md5?: string }
  ): Promise<void> {
    return downloadFile(this.client, remotePath, localPath, onProgress, mtime, expected);
  }

  remove(remotePath: string): Promise<void> {
    return this.client.deleteFile(remotePath, false);
  }
}
