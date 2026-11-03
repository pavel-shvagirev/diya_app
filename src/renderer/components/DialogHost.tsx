import { useEffect, useState, type ReactElement } from 'react';

import { baseName } from '../lib/entries.js';
import { t } from '../lib/strings.js';
import { useDialogStore, type DialogRequest } from '../store/dialogStore.js';
import { Icon } from '../ui/Icon.js';
import { Modal } from '../ui/Modal.js';

type Of<K extends DialogRequest['kind']> = Extract<DialogRequest, { kind: K }>;

function PromptDialog({ d, done }: { d: Of<'prompt'>; done: () => void }): ReactElement {
  const [value, setValue] = useState(d.initial);
  const [touched, setTouched] = useState(false);
  const error = d.validate?.(value) ?? null;
  const close = (v: string | null): void => {
    d.resolve(v);
    done();
  };
  return (
    <Modal title={d.title} onClose={() => close(null)}>
      <form
        className="field"
        onSubmit={e => {
          e.preventDefault();
          setTouched(true);
          if (!error) close(value.trim());
        }}
      >
        <label htmlFor="prompt-input">{d.label}</label>
        <input
          id="prompt-input"
          type="text"
          autoFocus
          value={value}
          onFocus={e => e.currentTarget.select()}
          onChange={e => {
            setValue(e.target.value);
            setTouched(true);
          }}
        />
        {touched && error && <span className="field__error">{error}</span>}
        <div className="modal__foot" style={{ padding: '12px 0 0', border: 0 }}>
          <button type="button" className="btn btn--outline" onClick={() => close(null)}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={Boolean(error)}>
            {d.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ d, done }: { d: Of<'confirm'>; done: () => void }): ReactElement {
  const close = (v: boolean): void => {
    d.resolve(v);
    done();
  };
  return (
    <Modal
      title={d.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn btn--outline" onClick={() => close(false)}>
            {t.cancel}
          </button>
          <button
            autoFocus
            className={d.danger ? 'btn btn--primary' : 'btn btn--primary'}
            style={d.danger ? { background: 'var(--ui-danger)' } : undefined}
            onClick={() => close(true)}
          >
            {d.submit}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{d.message}</p>
    </Modal>
  );
}

/** Lazy tree of remote folders, used by "move/copy to" and the sync folder picker. */
function PickerNode({
  path,
  depth,
  selected,
  onSelect,
}: {
  path: string;
  depth: number;
  selected: string;
  onSelect: (p: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(path === '/');
  const [dirs, setDirs] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || dirs) return;
    let alive = true;
    window.api
      .listFiles(path)
      .then(r => alive && setDirs(r.items.filter(i => i.type === 'dir').map(i => i.path)))
      .catch(() => alive && (setDirs([]), setFailed(true)));
    return () => {
      alive = false;
    };
  }, [open, dirs, path]);

  // Open ancestors of the preselected folder.
  useEffect(() => {
    if (selected.startsWith(path === '/' ? '/' : path + '/')) setOpen(true);
  }, [selected, path]);

  const hasChildren = dirs === null || dirs.length > 0;
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected === path}
        className={`tree-item${selected === path ? ' tree-item--selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => onSelect(path)}
      >
        <span
          className="tree-chevron"
          onClick={e => {
            e.stopPropagation();
            setOpen(o => !o);
          }}
        >
          {hasChildren && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />}
        </span>
        <Icon name={path === '/' ? 'cloud' : 'folder'} className="icon--folder" />
        <span className="tree-item__label">{path === '/' ? t.disk : baseName(path)}</span>
        {failed && <Icon name="alert" size={12} />}
      </div>
      {open &&
        dirs?.map(d => (
          <PickerNode key={d} path={d} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </>
  );
}

const normalizeRemote = (p: string): string => {
  const parts = p.split('/').filter(s => s && s !== '.' && s !== '..');
  return '/' + parts.join('/');
};

function FolderDialog({ d, done }: { d: Of<'folder'>; done: () => void }): ReactElement {
  const [selected, setSelected] = useState(normalizeRemote(d.initial));
  const close = (v: string | null): void => {
    d.resolve(v);
    done();
  };
  return (
    <Modal
      title={d.title}
      onClose={() => close(null)}
      footer={
        <>
          <button className="btn btn--outline" onClick={() => close(null)}>
            {t.cancel}
          </button>
          <button className="btn btn--primary" onClick={() => close(normalizeRemote(selected))}>
            {d.submit}
          </button>
        </>
      }
    >
      <div className="picker" role="tree">
        <PickerNode path="/" depth={0} selected={selected} onSelect={setSelected} />
      </div>
      <div className="field">
        <label htmlFor="picker-path">{t.chooseFolder}</label>
        <input
          id="picker-path"
          type="text"
          value={selected}
          onChange={e => setSelected(e.target.value)}
          spellCheck={false}
        />
      </div>
    </Modal>
  );
}

function ShareDialog({ d, done }: { d: Of<'share'>; done: () => void }): ReactElement {
  const [copied, setCopied] = useState(false);
  const close = (v: 'unshare' | null): void => {
    d.resolve(v);
    done();
  };
  return (
    <Modal
      title={`${t.shareTitle}: ${baseName(d.path)}`}
      onClose={() => close(null)}
      footer={
        <>
          <button className="btn btn--danger" onClick={() => close('unshare')}>
            {t.unshare}
          </button>
          <button className="btn btn--outline" onClick={() => close(null)}>
            {t.close}
          </button>
        </>
      }
    >
      <div className="linkbox">
        <input
          readOnly
          aria-label={t.shareTitle}
          value={d.url}
          onFocus={e => e.currentTarget.select()}
          autoFocus
        />
        <button
          className="btn btn--primary"
          onClick={() => {
            void navigator.clipboard.writeText(d.url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} /> {copied ? t.copied : t.copyLink}
        </button>
        <button className="btn btn--outline" onClick={() => void window.api.openExternal(d.url)}>
          {t.openLink}
        </button>
      </div>
    </Modal>
  );
}

/** Renders whichever promise-based dialog is currently requested. */
export function DialogHost(): ReactElement | null {
  const current = useDialogStore(s => s.current);
  const close = useDialogStore(s => s.close);
  if (!current) return null;
  // Own stacking layer: these dialogs can be opened from inside Settings and must sit above it.
  return (
    <div className="dialog-layer">
      {current.kind === 'prompt' && <PromptDialog d={current} done={close} />}
      {current.kind === 'confirm' && <ConfirmDialog d={current} done={close} />}
      {current.kind === 'folder' && <FolderDialog d={current} done={close} />}
      {current.kind === 'share' && <ShareDialog d={current} done={close} />}
    </div>
  );
}
