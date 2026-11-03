/**
 * Where the OAuth application ID (client_id) comes from, in priority order:
 *   1. the one the user typed on the sign-in screen (stored in settings.json),
 *   2. the YADISK_CLIENT_ID environment variable (developers).
 * Builds carry no application ID: every user registers their own Yandex OAuth application.
 * A client_id is public (it travels in browser URLs); it is not a secret.
 *
 * @module app-config
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { isLanguagePref, type LanguagePref } from '../shared/language.js';

export type ClientIdSource = 'custom' | 'env' | 'none';

export interface ResolvedClientId {
  clientId: string;
  source: ClientIdSource;
}

/** What a Yandex application ID looks like; also keeps pasted garbage (spaces, secrets) out. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const isValidClientId = (id: string): boolean => CLIENT_ID_PATTERN.test(id);

/** The application's secret looks the same (32 hex characters in practice). */
export const isValidClientSecret = (secret: string): boolean => CLIENT_ID_PATTERN.test(secret);

export function resolveClientId(sources: { custom?: string; env?: string }): ResolvedClientId {
  for (const source of ['custom', 'env'] as const) {
    const id = (sources[source] ?? '').trim();
    if (isValidClientId(id)) return { clientId: id, source };
  }
  return { clientId: '', source: 'none' };
}

interface SettingsFile {
  clientId?: string;
  deviceId?: string;
  language?: string;
}

/** Small non-secret settings file (custom client ID, stable device ID). */
export class SettingsStore {
  constructor(private readonly filePath: string) {}

  private read(): SettingsFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SettingsFile;
      return typeof raw === 'object' && raw ? raw : {};
    } catch {
      return {};
    }
  }

  private write(next: SettingsFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  getClientId(): string {
    return this.read().clientId ?? '';
  }

  /** '' removes the custom ID. Throws on a malformed one. */
  setClientId(id: string): void {
    const trimmed = id.trim();
    if (trimmed && !isValidClientId(trimmed)) throw new Error('Invalid Client ID');
    const next = this.read();
    if (trimmed) next.clientId = trimmed;
    else delete next.clientId;
    this.write(next);
  }

  getLanguage(): LanguagePref {
    const v = this.read().language;
    return isLanguagePref(v) ? v : 'system';
  }

  setLanguage(pref: LanguagePref): void {
    this.write({ ...this.read(), language: pref });
  }

  /** Generated once, then reused: Yandex ties device tokens to it. */
  getDeviceId(): string {
    const settings = this.read();
    if (settings.deviceId) return settings.deviceId;
    const deviceId = randomUUID();
    this.write({ ...settings, deviceId });
    return deviceId;
  }
}
