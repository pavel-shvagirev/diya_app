/** Interface language: follows the system until the user fixes one in Settings. */
export type Lang = 'ru' | 'en';
export type LanguagePref = 'system' | Lang;

export const LANGUAGE_PREFS: readonly LanguagePref[] = ['system', 'ru', 'en'];

export const isLanguagePref = (v: unknown): v is LanguagePref =>
  typeof v === 'string' && (LANGUAGE_PREFS as readonly string[]).includes(v);

/** A locale such as "ru-RU" or "en_US" → the interface language (Russian or English only). */
export const langFromLocale = (locale: string | undefined): Lang =>
  (locale ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

export const resolveLanguage = (pref: LanguagePref, systemLocale: string | undefined): Lang =>
  pref === 'system' ? langFromLocale(systemLocale) : pref;

/** Yandex OAuth site for the interface language: .ru for Russian, .com for English. */
export const oauthHost = (lang: Lang): string =>
  lang === 'ru' ? 'https://oauth.yandex.ru' : 'https://oauth.yandex.com';
