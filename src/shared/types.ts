import type { LanguagePref } from './language.js';
import type { LogEntry, LogLevel } from './log.js';
// File metadata from Yandex.Disk API
export interface FileMetadata {
  type: 'file' | 'dir' | 'shortcut';
  name: string;
  path: string;
  href: string;
  upload_href?: string;
  size?: number;
  mime_type?: string;
  content_length?: number;
  modified?: string;
  thumbnail_href?: string;
  is_trash?: boolean;
  is_folder?: boolean;
  public_url?: string;
  sha256?: string;
  md5?: string;
}

// Yandex.Disk quota/info response
export interface DiskInfo {
  type: 'disk';
  max_file_size?: string;
  alias?: string;
  total_space: number;
  used_space: number;
  trash_size: number;
  next_token?: string;
}

/** What the sign-in screen shows while the user confirms the code in the browser. */
export interface DeviceLogin {
  userCode: string;
  verificationUrl: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

/** Why a browser sign-in did not finish; the screen turns the kind into a sentence. */
export interface LoginFailure {
  kind: 'expired' | 'denied' | 'bad_client' | 'other';
  detail?: string;
}

export interface AuthConfigInfo {
  source: 'custom' | 'env' | 'none';
  clientId: string;
  /** A client secret is stored. */
  hasSecret: boolean;
}

// Sync progress, as reported by the sync engine
export interface SyncProgress {
  phase: 'idle' | 'scanning' | 'syncing' | 'paused' | 'error';
  totalFiles: number;
  doneFiles: number;
  totalBytes: number;
  doneBytes: number;
  current: {
    path: string;
    direction: 'upload' | 'download' | 'delete';
    done: number;
    total: number;
  } | null;
  lastSync: string | null;
  error: string | null;
  failures: string[];
  conflicts: number;
}

// Configured sync pair (single pair supported)
export interface SyncConfig {
  localPath: string;
  remotePath: string;
  enabled: boolean;
}

export type SyncState = SyncProgress & { configured: boolean; enabled: boolean };

// A manual upload/download reported to the UI
export interface TransferEvent {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  done: number;
  total: number;
  status: 'active' | 'done' | 'error';
  error?: string;
}

// Paginated file list response
export interface FileInfoList {
  total: number;
  items: FileMetadata[];
  limit: number;
  offset: number;
  href: string;
  next_token?: string;
  previous_token?: string;
}

// ── Sync DB types ─────────────────────────────────────────────

// Conflict detected during sync
export interface SyncConflict {
  type: 'both-modified' | 'only-local-modified' | 'only-remote-modified';
  localHash: string | null;
  remoteHash: string | null;
  localModified?: string;
  remoteModified?: string;
  localPath: string;
  remotePath: string;
}

// File metadata stored in the sync database
export interface SyncFileMeta {
  id: string;
  localPath: string;
  remotePath: string;
  size: number;
  modified: string;
  localHash: string;
  remoteHash: string;
  lastSyncedLocal: string;
  lastSyncedRemote: string;
  status: 'synced' | 'conflicted' | 'pending';
  conflictType?: 'both-modified' | 'only-local-modified' | 'only-remote-modified';
}

// Database operation in the queue
export interface SyncDBOperation {
  id: string;
  pairId: string;
  type: 'upload' | 'download';
  status: 'pending' | 'completed' | 'failed';
  filePath: string;
  remotePath: string;
  errorMessage?: string;
  retryCount?: number;
  createdAt: string;
  completedAt?: string;
}

// Last-known delta position for Yandex.Disk /changes
export interface SyncPosition {
  fromToken: string | null;
  fromId: string | null;
  lastPoll: string | null;
}

// Application API exposed to renderer
export interface AppApi {
  // Auth
  /** Start the browser sign-in; resolves with the code to show. Success arrives via onAuthChanged. */
  authLogin: () => Promise<DeviceLogin>;
  authLoginCancel: () => Promise<void>;
  authConfig: () => Promise<AuthConfigInfo>;
  languageGet: () => Promise<LanguagePref>;
  languageSet: (pref: LanguagePref) => Promise<void>;
  /** '' removes the custom Client ID. */
  /** `clientSecret`: undefined keeps the saved one, '' removes it. */
  authSetClientId: (clientId: string, clientSecret?: string) => Promise<AuthConfigInfo>;
  onAuthLoginFailed: (cb: (failure: LoginFailure) => void) => () => void;
  authLogout: () => Promise<void>;
  authStatus: () => Promise<{ isAuthenticated: boolean }>;
  authSetToken: (token: string) => Promise<void>;
  onAuthChanged: (cb: (isAuthenticated: boolean) => void) => () => void;

  // Files
  getDiskInfo: () => Promise<DiskInfo>;
  listFiles: (path: string) => Promise<FileInfoList>;
  /** Upload into `remoteDir`. Without `localPaths` the main process asks the user to pick files. */
  uploadFiles: (remoteDir: string, localPaths?: string[]) => Promise<void>;
  /** Download to a folder the user picks in a native dialog. Resolves false if cancelled. */
  downloadFiles: (remotePaths: string[]) => Promise<boolean>;
  deleteFile: (path: string, permanently?: boolean) => Promise<void>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<void>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  publish: (path: string) => Promise<string>;
  unpublish: (path: string) => Promise<void>;
  getQuota: () => Promise<DiskInfo>;
  getTrashList: () => Promise<FileInfoList>;
  restoreFromTrash: (path: string) => Promise<void>;
  deleteFromTrash: (path: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  /** Real filesystem path of a File from a drop event. */
  pathForFile: (file: File) => string;
  onTransferProgress: (cb: (e: TransferEvent) => void) => () => void;

  // Dialogs
  selectFolder: (title?: string) => Promise<string | null>;

  // Sync
  getSyncConfig: () => Promise<SyncConfig | null>;
  configureSync: (localPath: string, remotePath: string) => Promise<void>;
  startSync: () => Promise<void>;
  pauseSync: () => Promise<void>;
  syncNow: () => Promise<void>;
  getSyncStatus: () => Promise<SyncState>;
  onSyncProgress: (cb: (p: SyncProgress) => void) => () => void;
  /** Sync was enabled / paused outside the window (tray). */
  onSyncConfigChanged: (cb: () => void) => () => void;
  /** Tray or app menu asked to open Settings. */
  onOpenSettings: (cb: () => void) => () => void;
  // Log window
  logGet: () => Promise<{ entries: LogEntry[]; recordLevel: LogLevel; file: string | null }>;
  logClear: () => Promise<void>;
  logSetRecordLevel: (level: LogLevel) => Promise<void>;
  logReveal: () => Promise<void>;
  onLogEntry: (cb: (entry: LogEntry) => void) => () => void;

  // Tray
  showWindow: () => Promise<void>;
  quit: () => Promise<void>;

  // System
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
}
