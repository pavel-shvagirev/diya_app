import { t } from './strings.js';

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoText(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return t.justNow;
  if (minutes < 60) return t.minAgo(minutes);
  if (minutes < 60 * 24) return t.hoursAgo(Math.floor(minutes / 60));
  return t.daysAgo(Math.floor(minutes / (60 * 24)));
}
