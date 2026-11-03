import { useEffect, useState, type ReactElement } from 'react';

import { agoText } from '../lib/ago.js';
import { formatDate, formatSize, percent } from '../lib/format.js';
import { lang, t } from '../lib/strings.js';
import { useBrowserStore } from '../store/browserStore.js';
import { dialogs } from '../store/dialogStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { useThemeStore, type ThemeMode } from '../store/themeStore.js';
import { useUiStore } from '../store/uiStore.js';
import { DiskLogo } from '../ui/DiskLogo.js';
import { Icon } from '../ui/Icon.js';
import { Modal } from '../ui/Modal.js';
import type { LanguagePref } from '../../shared/language.js';

function phaseText(phase: string, enabled: boolean): string {
  if (!enabled || phase === 'paused') return t.syncPaused;
  if (phase === 'error') return t.syncError;
  if (phase === 'scanning') return t.syncScanning;
  if (phase === 'syncing') return t.secSync + '…';
  return t.syncUpToDate('').replace(/\s*·\s*$/, '');
}

function SyncSection(): ReactElement {
  const config = useSyncStore(s => s.config);
  const progress = useSyncStore(s => s.progress);
  const configure = useSyncStore(s => s.configure);
  const setEnabled = useSyncStore(s => s.setEnabled);
  const syncNow = useSyncStore(s => s.syncNow);

  const [local, setLocal] = useState(config?.localPath ?? '');
  const [remote, setRemote] = useState(config?.remotePath ?? t.defaultRemoteFolder);
  useEffect(() => {
    if (config) {
      setLocal(config.localPath);
      setRemote(config.remotePath);
    }
  }, [config]);

  const changed = !config || config.localPath !== local || config.remotePath !== remote;
  const busy = progress.phase === 'syncing' || progress.phase === 'scanning';
  const pct = progress.totalBytes
    ? percent(progress.doneBytes, progress.totalBytes)
    : percent(progress.doneFiles, progress.totalFiles);

  return (
    <section className="section">
      <h3>{t.secSync}</h3>

      <div className="field">
        <span className="field__label">{t.localFolder}</span>
        <div className="pathrow">
          <span className={`pathrow__value${local ? '' : ' pathrow__value--empty'}`} title={local}>
            {local || t.notChosen}
          </span>
          <button
            className="btn btn--outline"
            title={t.tipChooseLocal}
            onClick={() => void window.api.selectFolder(t.localFolder).then(p => p && setLocal(p))}
          >
            {t.choosePlus}
          </button>
          {config && (
            <button
              className="btn btn--outline"
              title={t.tipShowLocal}
              onClick={() => void window.api.showInFolder(config.localPath)}
            >
              {t.showInFinder}
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field__label">{t.remoteFolder}</span>
        <div className="pathrow">
          <span className="pathrow__value" title={remote}>
            {remote}
          </span>
          <button
            className="btn btn--outline"
            title={t.tipChooseRemote}
            onClick={() =>
              void dialogs
                .pickFolder({ title: t.remoteFolder, submit: t.choose, initial: remote })
                .then(p => p && setRemote(p))
            }
          >
            {t.choosePlus}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn btn--primary"
          title={!local ? `${t.tipApplySync} — ${t.tipChooseLocal}` : t.tipApplySync}
          disabled={!local || !changed}
          onClick={() => void configure(local, remote)}
        >
          {t.applySync}
        </button>
        {config && (
          <>
            <label className="switch" title={t.tipSyncToggle}>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={e => void setEnabled(e.target.checked)}
              />
              {t.syncEnabled}
            </label>
            <button
              className="btn btn--outline"
              title={t.tipSyncNow}
              disabled={!config.enabled || busy}
              onClick={() => void syncNow()}
            >
              <Icon name="sync" /> {t.syncNow}
            </button>
          </>
        )}
      </div>

      {config && (
        <dl className="kv">
          <dt>{t.secSync}</dt>
          <dd>{phaseText(progress.phase, config.enabled)}</dd>
          <dt>{t.lastSync}</dt>
          <dd>
            {progress.lastSync
              ? `${formatDate(progress.lastSync, lang)} (${agoText(progress.lastSync)})`
              : t.syncNever}
          </dd>
          {busy && progress.phase === 'syncing' && (
            <>
              <dt>{t.transfers}</dt>
              <dd>
                {progress.doneFiles} / {progress.totalFiles} ·{' '}
                {formatSize(progress.doneBytes, lang)} / {formatSize(progress.totalBytes, lang)} ·{' '}
                {pct}%
                <div className="progress" style={{ width: '100%', marginTop: 4 }}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </dd>
              {progress.current && (
                <>
                  <dt>{t.currentFile}</dt>
                  <dd title={progress.current.path}>{progress.current.path}</dd>
                </>
              )}
            </>
          )}
        </dl>
      )}

      {progress.error && (
        <div className="field__error" role="alert">
          {progress.error}
        </div>
      )}
      {progress.conflicts > 0 && <div className="hint">{t.conflictsCount(progress.conflicts)}</div>}
      {progress.failures.length > 0 && (
        <div>
          <div className="field__label">{t.failuresTitle}</div>
          <ul className="failures">
            {progress.failures.map(f => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>
        {t.syncHint}
      </p>
    </section>
  );
}

function AppearanceSection(): ReactElement {
  const mode = useThemeStore(s => s.mode);
  const setMode = useThemeStore(s => s.setMode);
  const options: Array<[ThemeMode, string]> = [
    ['system', t.themeSystem],
    ['light', t.themeLight],
    ['dark', t.themeDark],
  ];
  return (
    <section className="section">
      <h3>{t.secAppearance}</h3>
      <div className="field">
        <span className="field__label">{t.theme}</span>
        <div className="radios" role="radiogroup" aria-label={t.theme}>
          {options.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="theme"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <LanguageField />
    </section>
  );
}

/** System / Русский / English. Changing it makes the main process reload the window. */
function LanguageField(): ReactElement {
  const [pref, setPref] = useState<LanguagePref>('system');
  useEffect(() => {
    void window.api.languageGet().then(setPref);
  }, []);
  const options: Array<[LanguagePref, string]> = [
    ['system', t.langSystem],
    ['ru', t.langRu],
    ['en', t.langEn],
  ];
  return (
    <div className="field">
      <span className="field__label">{t.language}</span>
      <div className="radios" role="radiogroup" aria-label={t.language}>
        {options.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="language"
              checked={pref === value}
              onChange={() => {
                setPref(value);
                void window.api.languageSet(value);
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function AccountSection(): ReactElement {
  const quota = useBrowserStore(s => s.quota);
  return (
    <section className="section">
      <h3 className="with-logo">
        <DiskLogo />
        {t.secAccount}
      </h3>
      {quota && (
        <div className="muted">
          {t.quota(formatSize(quota.used, lang), formatSize(quota.total, lang))}
        </div>
      )}
      <div>
        <button
          className="btn btn--outline btn--danger"
          title={t.tipSignOut}
          onClick={() => void window.api.authLogout()}
        >
          {t.signOut}
        </button>
      </div>
    </section>
  );
}

export function SettingsDialog(): ReactElement {
  const close = useUiStore(s => s.closeSettings);
  return (
    <Modal title={t.settingsTitle} onClose={close} wide>
      <SyncSection />
      <AppearanceSection />
      <AccountSection />
    </Modal>
  );
}
