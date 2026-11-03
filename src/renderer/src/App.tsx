import { useEffect, useRef, useState, type ReactElement } from 'react';

import { DialogHost } from '../components/DialogHost.js';
import { FileTable } from '../components/FileTable.js';
import { FolderTree } from '../components/FolderTree.js';
import { OfflineBanner } from '../components/OfflineBanner.js';
import { SettingsDialog } from '../components/SettingsDialog.js';
import { StatusBar } from '../components/StatusBar.js';
import { Toasts } from '../components/Toasts.js';
import { Toolbar } from '../components/Toolbar.js';
import { t } from '../lib/strings.js';
import { AuthPage } from '../pages/AuthPage.js';
import { useBrowserStore } from '../store/browserStore.js';
import { useErrorStore } from '../store/errorStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { useTransferStore } from '../store/transferStore.js';
import { useUiStore } from '../store/uiStore.js';

/** Draggable divider between the folder tree and the listing. */
function Splitter(): ReactElement {
  const setTreeWidth = useUiStore(s => s.setTreeWidth);
  const [active, setActive] = useState(false);
  const start = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
  };
  return (
    <div
      className={active ? 'splitter splitter--active' : 'splitter'}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={start}
      onPointerMove={e => active && setTreeWidth(e.clientX)}
      onPointerUp={() => setActive(false)}
    />
  );
}

function FileManager(): ReactElement {
  const treeWidth = useUiStore(s => s.treeWidth);
  const settingsOpen = useUiStore(s => s.settingsOpen);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const b = useBrowserStore.getState();
    void b.openFolder('/');
    void b.loadQuota();
    void useSyncStore.getState().refresh();
  }, []);

  useEffect(() => {
    const offSync = window.api.onSyncProgress(p => {
      const was = useSyncStore.getState().progress.phase;
      useSyncStore.getState().applyProgress(p);
      // A finished run may have changed what is on the Disk: re-read the view.
      if (
        (was === 'syncing' || was === 'scanning') &&
        p.phase !== 'syncing' &&
        p.phase !== 'scanning'
      ) {
        void useBrowserStore.getState().refresh();
        void useBrowserStore.getState().loadQuota();
      }
    });
    const offTransfer = window.api.onTransferProgress(e => useTransferStore.getState().apply(e));
    const offConfig = window.api.onSyncConfigChanged(() => void useSyncStore.getState().refresh());
    const offSettings = window.api.onOpenSettings(() => useUiStore.getState().openSettings());
    return () => {
      offSync();
      offTransfer();
      offConfig();
      offSettings();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <OfflineBanner onRetry={() => void useBrowserStore.getState().refresh()} />
      <div className="main" style={{ gridTemplateColumns: `${treeWidth}px 4px minmax(0, 1fr)` }}>
        <FolderTree />
        <Splitter />
        <div className="content">
          <FileTable />
        </div>
      </div>
      <StatusBar />
      <Toasts />
      <DialogHost />
      {settingsOpen && <SettingsDialog />}
    </div>
  );
}

function App(): ReactElement {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    void window.api
      .authStatus()
      .then(r => setAuth(r.isAuthenticated))
      .catch(() => setAuth(false));
    return window.api.onAuthChanged(isAuth => {
      if (!isAuth) useErrorStore.getState().clearErrors();
      setAuth(isAuth);
    });
  }, []);

  if (auth === null) return <div style={{ padding: 16 }}>{t.loading}</div>;
  if (!auth) return <AuthPage onAuthenticated={() => setAuth(true)} />;
  return <FileManager />;
}

export default App;
