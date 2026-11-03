import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { CH, EVENTS } from '../shared/channels.js';
import type { AppApi } from '../shared/types.js';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel as string, ...args) as Promise<T>;
}

/** Subscribe to a main → renderer push event; returns the unsubscribe function. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(event, listener);
  return () => {
    ipcRenderer.removeListener(event, listener);
  };
}

const api: AppApi = {
  authLogin: () => invoke(CH.AUTH_LOGIN),
  authLoginCancel: () => invoke(CH.AUTH_LOGIN_CANCEL),
  authConfig: () => invoke(CH.AUTH_CONFIG),
  languageGet: () => invoke(CH.LANGUAGE_GET),
  languageSet: pref => invoke(CH.LANGUAGE_SET, pref),
  authSetClientId: (clientId, clientSecret) =>
    invoke(CH.AUTH_SET_CLIENT_ID, clientId, clientSecret),
  onAuthLoginFailed: cb => subscribe(EVENTS.AUTH_LOGIN_FAILED, cb),
  authLogout: () => invoke(CH.AUTH_LOGOUT),
  authStatus: () => invoke(CH.AUTH_STATUS),
  authSetToken: (token: string) => invoke(CH.AUTH_SET_TOKEN, token),
  onAuthChanged: cb => subscribe(EVENTS.AUTH_CHANGED, cb),
  getDiskInfo: () => invoke(CH.FILES_QUOTA),
  listFiles: (path: string) => invoke(CH.FILES_LIST, path),
  uploadFiles: (remoteDir: string, localPaths?: string[]) =>
    invoke(CH.FILES_UPLOAD, remoteDir, localPaths),
  downloadFiles: (remotePaths: string[]) => invoke(CH.FILES_DOWNLOAD, remotePaths),
  deleteFile: (path: string, permanently = false) => invoke(CH.FILES_DELETE, path, permanently),
  copyFile: (sourcePath: string, targetPath: string) =>
    invoke(CH.FILES_COPY, sourcePath, targetPath),
  moveFile: (sourcePath: string, targetPath: string) =>
    invoke(CH.FILES_MOVE, sourcePath, targetPath),
  mkdir: (path: string) => invoke(CH.FILES_MKDIR, path),
  publish: (path: string) => invoke(CH.FILES_PUBLISH, path),
  unpublish: (path: string) => invoke(CH.FILES_UNPUBLISH, path),
  getQuota: () => invoke(CH.FILES_QUOTA),
  getTrashList: () => invoke(CH.FILES_TRASH),
  restoreFromTrash: (path: string) => invoke(CH.TRASH_RESTORE, path),
  deleteFromTrash: (path: string) => invoke(CH.TRASH_DELETE, path),
  emptyTrash: () => invoke(CH.TRASH_EMPTY),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onTransferProgress: cb => subscribe(EVENTS.TRANSFER_PROGRESS, cb),
  selectFolder: (title?: string) => invoke(CH.DIALOG_SELECT_FOLDER, title),
  getSyncConfig: () => invoke(CH.SYNC_GET_CONFIG),
  configureSync: (localPath: string, remotePath: string) =>
    invoke(CH.SYNC_CONFIGURE, localPath, remotePath),
  startSync: () => invoke(CH.SYNC_START),
  pauseSync: () => invoke(CH.SYNC_PAUSE),
  syncNow: () => invoke(CH.SYNC_NOW),
  getSyncStatus: () => invoke(CH.SYNC_STATUS),
  onSyncProgress: cb => subscribe(EVENTS.SYNC_PROGRESS, cb),
  onSyncConfigChanged: cb => subscribe(EVENTS.SYNC_CONFIG_CHANGED, cb),
  onOpenSettings: cb => subscribe(EVENTS.OPEN_SETTINGS, cb),
  logGet: () => invoke(CH.LOG_GET),
  logClear: () => invoke(CH.LOG_CLEAR),
  logSetRecordLevel: level => invoke(CH.LOG_SET_LEVEL, level),
  logReveal: () => invoke(CH.LOG_REVEAL),
  onLogEntry: cb => subscribe(EVENTS.LOG_ENTRY, cb),
  showWindow: () => invoke(CH.TRAY_SHOW),
  quit: () => invoke(CH.TRAY_QUIT),
  openExternal: (url: string) => invoke(CH.SYSTEM_OPEN_EXTERNAL, url),
  showInFolder: (path: string) => invoke(CH.SYSTEM_SHOW_IN_FOLDER, path),
};

contextBridge.exposeInMainWorld('api', api);
