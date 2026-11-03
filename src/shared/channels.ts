// IPC channel names shared by main, preload and tests.
export const CH = {
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  AUTH_SET_TOKEN: 'auth:setToken',
  AUTH_LOGIN_CANCEL: 'auth:loginCancel',
  AUTH_CONFIG: 'auth:config',
  AUTH_SET_CLIENT_ID: 'auth:setClientId',
  LANGUAGE_GET: 'language:get',
  LANGUAGE_SET: 'language:set',
  FILES_LIST: 'files:list',
  FILES_UPLOAD: 'files:upload',
  FILES_DOWNLOAD: 'files:download',
  FILES_DELETE: 'files:delete',
  FILES_COPY: 'files:copy',
  FILES_MOVE: 'files:move',
  FILES_MKDIR: 'files:mkdir',
  FILES_PUBLISH: 'files:publish',
  FILES_UNPUBLISH: 'files:unpublish',
  FILES_TRASH: 'files:trash',
  FILES_QUOTA: 'files:quota',
  TRASH_RESTORE: 'trash:restore',
  TRASH_DELETE: 'trash:delete',
  TRASH_EMPTY: 'trash:empty',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_GET_CONFIG: 'sync:getConfig',
  SYNC_START: 'sync:start',
  SYNC_PAUSE: 'sync:pause',
  SYNC_NOW: 'sync:now',
  SYNC_STATUS: 'sync:status',
  DIALOG_SELECT_FOLDER: 'dialog:selectFolder',
  TRAY_SHOW: 'tray:show',
  TRAY_QUIT: 'tray:quit',
  SYSTEM_OPEN_EXTERNAL: 'system:openExternal',
  SYSTEM_SHOW_IN_FOLDER: 'system:showInFolder',
  LOG_GET: 'log:get',
  LOG_CLEAR: 'log:clear',
  LOG_SET_LEVEL: 'log:setLevel',
  LOG_REVEAL: 'log:reveal',
} as const;

/** Main → renderer push events. */
export const EVENTS = {
  AUTH_CHANGED: 'auth-changed',
  /** Result of a device-flow sign-in that did not succeed. */
  AUTH_LOGIN_FAILED: 'auth:login-failed',
  SYNC_PROGRESS: 'sync:progress',
  TRANSFER_PROGRESS: 'transfer:progress',
  /** Sync pair / enabled flag changed outside the renderer (tray, menu). */
  SYNC_CONFIG_CHANGED: 'sync:config-changed',
  /** Ask the renderer to open the Settings dialog (tray / app menu). */
  OPEN_SETTINGS: 'ui:open-settings',
  /** A new log entry (log window only). */
  LOG_ENTRY: 'log:entry',
} as const;
