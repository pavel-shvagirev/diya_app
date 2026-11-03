# Выпуск релизов

Сборки не содержат идентификатора или секрета приложения Яндекса, workflow релиза их не требует:
каждый пользователь регистрирует своё приложение, см. [SIGN_IN.md](SIGN_IN.md).

## Выпуск релиза

1. Обновите `version` в `package.json`, а также `CHANGELOG.en.md` и `CHANGELOG.md`.
2. `npm run check` должен проходить.
3. Тег и пуш: `git tag v0.2.0 && git push origin v0.2.0`.
4. Workflow **Release** собирает Linux (AppImage, deb, rpm), macOS (dmg и zip, только Apple Silicon) и Windows
   (установщик и portable) и прикладывает всё к **черновику** релиза. Проверьте артефакты и
   опубликуйте черновик.

Локальная сборка для своей ОС: `npm run dist` (файлы в `release/`). Для rpm в Linux нужен пакет
`rpm`; dmg собирается только на macOS; установщики Windows — на Windows.

## Подпись

- macOS: ad-hoc подпись (`mac.identity: "-"`, без сертификата); без нотаризации.
- Windows: без подписи.
- CI задаёт `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, сертификаты не подхватываются.

Подпись Developer ID и нотаризация: добавьте в окружение workflow `CSC_LINK`, `CSC_KEY_PASSWORD`
(сертификаты macOS и Windows) и для нотаризации `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`; уберите `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, `mac.identity` и entitlement
`com.apple.security.cs.disable-library-validation` в `build/entitlements.mac.plist`.
Подробнее: <https://www.electron.build/> (раздел «Code Signing»).
