/**
 * Human-readable formatting for sizes, dates and file kinds.
 *
 * @module format
 */
import { extensionOf, type Entry } from './entries.js';

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
const UNITS_EN = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number | undefined, lang: 'ru' | 'en' = 'ru'): string {
  if (bytes === undefined) return '';
  const units = lang === 'ru' ? UNITS : UNITS_EN;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const num = i === 0 || v >= 100 ? Math.round(v).toString() : v.toFixed(1);
  return `${num.replace('.', lang === 'ru' ? ',' : '.')} ${units[i]}`;
}

export function formatDate(iso: string | undefined, lang: string = 'ru'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Percentage 0–100, clamped; 0 when total is unknown. */
export function percent(done: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

const KIND_BY_EXT: Record<string, 'image' | 'audio' | 'video' | 'archive' | 'text' | 'doc'> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  heic: 'image',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  webm: 'video',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  txt: 'text',
  md: 'text',
  json: 'text',
  csv: 'text',
  log: 'text',
  pdf: 'doc',
  doc: 'doc',
  docx: 'doc',
  xls: 'doc',
  xlsx: 'doc',
  ppt: 'doc',
  pptx: 'doc',
  odt: 'doc',
};

export type Kind = 'folder' | 'image' | 'audio' | 'video' | 'archive' | 'text' | 'doc' | 'file';

export function kindOf(e: Pick<Entry, 'name' | 'type'>): Kind {
  if (e.type === 'dir') return 'folder';
  return KIND_BY_EXT[extensionOf(e)] ?? 'file';
}
