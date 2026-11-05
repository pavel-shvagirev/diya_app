# Выпуск релизов

Сборки не содержат идентификатора или секрета приложения Яндекса, workflow релиза их не требует:
каждый пользователь регистрирует своё приложение, см. [SIGN_IN.md](SIGN_IN.md).

## Выпуск релиза

1. Обновите `version` в `package.json` (и `package-lock.json`:
   `npm version X.Y.Z --no-git-tag-version`), а в `CHANGELOG.en.md` и `CHANGELOG.md` переименуйте
   `[Не выпущено]` / `[Unreleased]` в `[X.Y.Z] - дата` и оставьте над ним пустой раздел.
2. `npm run check` должен проходить, CI на `main` — быть зелёным на всех трёх системах.
3. По желанию пробный прогон: **Actions → Release → Run workflow** на `main` собирает все
   установщики без тега и без релиза; скачайте их из артефактов прогона и попробуйте.
4. Тег и пуш: `git tag vX.Y.Z && git push origin vX.Y.Z` (тег должен совпадать с версией в
   `package.json`, workflow это проверяет и ничего не собирает, пока CI для этого коммита не
   зелёный).
5. Workflow **Release** собирает Linux x64 и arm64 (AppImage, deb, rpm; собираются на Ubuntu 26.04,
   то есть рассчитаны на Ubuntu 26.04+ и другие дистрибутивы с такой же новой glibc), macOS (dmg и
   zip, только Apple Silicon) и Windows x64 и arm64 (установщик и portable), каждую архитектуру на
   своём раннере, и прикладывает всё к **черновику** релиза. Проверьте артефакты и опубликуйте
   черновик.
6. Workflow также прикладывает `SHA256SUMS.txt` и подтверждение сборки (нужны права `id-token` и
   `attestations` у джоба публикации). Перед публикацией: замените автоматические заметки разделом
   `[X.Y.Z]` из списка изменений, поставьте хотя бы одну сборку и проверьте вход, просмотр и
   синхронизацию.

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
