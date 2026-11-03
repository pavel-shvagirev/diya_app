/**
 * Labels for the native menus (tray and application menu). Follow the interface language (Settings, else the OS).
 *
 * @module menu-strings
 */
import { langFromLocale } from '../shared/language.js';
import { effectiveLanguage } from './language.js';

const ru = {
  appName: 'Diya',
  open: 'Открыть',
  pauseSync: 'Приостановить синхронизацию',
  resumeSync: 'Возобновить синхронизацию',
  setupSync: 'Настроить синхронизацию…',
  settings: 'Настройки…',
  showLog: 'Журнал…',
  quitHint: (key: string) => `Нажмите ${key} ещё раз, чтобы выйти из программы`,
  logTitle: 'Журнал — Diya',
  saveTo: 'Куда сохранить',
  quit: 'Завершить',
  tipIdle: 'Diya',
  tipSyncing: 'Diya — синхронизация…',
  tipError: 'Diya — ошибка синхронизации',
  tipPaused: 'Diya — синхронизация на паузе',
  edit: 'Правка',
  view: 'Вид',
  window: 'Окно',
  file: 'Файл',
  hide: 'Скрыть Diya',
  hideOthers: 'Скрыть остальные',
  unhide: 'Показать все',
  undo: 'Отменить',
  redo: 'Повторить',
  cut: 'Вырезать',
  copy: 'Копировать',
  paste: 'Вставить',
  selectAll: 'Выбрать всё',
  fullscreen: 'Во весь экран',
  minimize: 'Свернуть',
  zoom: 'Увеличить',
  front: 'Все окна на передний план',
  close: 'Закрыть окно',
};

const en: typeof ru = {
  appName: 'Diya',
  open: 'Open',
  pauseSync: 'Pause sync',
  resumeSync: 'Resume sync',
  setupSync: 'Set up sync…',
  settings: 'Settings…',
  showLog: 'Log…',
  quitHint: (key: string) => `Press ${key} again to quit`,
  logTitle: 'Log — Diya',
  saveTo: 'Save to',
  quit: 'Quit',
  tipIdle: 'Diya',
  tipSyncing: 'Diya — syncing…',
  tipError: 'Diya — sync error',
  tipPaused: 'Diya — sync paused',
  edit: 'Edit',
  view: 'View',
  window: 'Window',
  file: 'File',
  hide: 'Hide Diya',
  hideOthers: 'Hide others',
  unhide: 'Show all',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  fullscreen: 'Toggle full screen',
  minimize: 'Minimize',
  zoom: 'Zoom',
  front: 'Bring all to front',
  close: 'Close window',
};

export type MenuStrings = typeof ru;

/** Labels in the language chosen in Settings (or the system one); `locale` forces one (tests). */
export function menuStrings(locale?: string): MenuStrings {
  return (locale ? langFromLocale(locale) : effectiveLanguage()) === 'ru' ? ru : en;
}
