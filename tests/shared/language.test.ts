import { describe, expect, it } from 'vitest';

import { isLanguagePref, langFromLocale, resolveLanguage } from '../../src/shared/language.js';

describe('language helpers', () => {
  it('maps locales to Russian or English', () => {
    expect(langFromLocale('ru-RU')).toBe('ru');
    expect(langFromLocale('RU')).toBe('ru');
    expect(langFromLocale('en_US')).toBe('en');
    expect(langFromLocale('de-DE')).toBe('en');
    expect(langFromLocale(undefined)).toBe('en');
  });

  it('a fixed choice wins over the system language; "system" follows it', () => {
    expect(resolveLanguage('en', 'ru-RU')).toBe('en');
    expect(resolveLanguage('ru', 'en-US')).toBe('ru');
    expect(resolveLanguage('system', 'ru-RU')).toBe('ru');
    expect(resolveLanguage('system', 'fr')).toBe('en');
  });

  it('recognises only the three preferences', () => {
    for (const v of ['system', 'ru', 'en']) expect(isLanguagePref(v)).toBe(true);
    for (const v of ['de', '', null, 5, undefined]) expect(isLanguagePref(v)).toBe(false);
  });
});
