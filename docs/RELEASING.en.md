# Releases

Builds contain no Yandex application ID or secret and the release workflow needs none: each user
registers their own application, see [SIGN_IN.en.md](SIGN_IN.en.md).

## Making a release

1. Update `version` in `package.json` (and `package-lock.json`: `npm version X.Y.Z --no-git-tag-version`),
   and in `CHANGELOG.en.md` / `CHANGELOG.md` rename `[Unreleased]` to `[X.Y.Z] - date` and leave an
   empty `[Unreleased]` above it.
2. `npm run check` must pass, and CI on `main` must be green on all three systems.
3. Optional dry run: **Actions → Release → Run workflow** on `main` builds all installers without
   a tag and without a release; download them from the run's artifacts and try them.
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must equal the version in
   `package.json`, the workflow checks it).
5. The **Release** workflow builds on Linux x64 and arm64 (AppImage, deb, rpm; built on Ubuntu 26.04, so they target Ubuntu 26.04+ and
   other distributions with a glibc that new), macOS (dmg and zip, Apple
   Silicon only) and Windows x64 and arm64 (installer and portable), each on a runner of its own
   architecture, and attaches everything to a **draft** release. Review the
   artifacts, then publish the draft.
6. The workflow also attaches `SHA256SUMS.txt` and a build attestation (needs the `id-token` and
   `attestations` permissions of the publish job). Before publishing: replace the generated notes with the `[X.Y.Z]` section of the changelog,
   install at least one bundle and check sign-in, browsing and sync.

Local build for your OS: `npm run dist` (files appear in `release/`). The rpm target needs the
`rpm` package on Linux; dmg builds only on macOS; Windows installers build on Windows.

## Signing

- macOS: ad-hoc signature (`mac.identity: "-"`, no certificate); not notarized.
- Windows: unsigned.
- CI sets `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, so no certificate is picked up.

Developer ID signing and notarization: add `CSC_LINK`, `CSC_KEY_PASSWORD` (macOS and Windows
certificates) and, for notarization, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` to
the workflow environment; remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, `mac.identity` and the
`com.apple.security.cs.disable-library-validation` entitlement in `build/entitlements.mac.plist`.
Details: <https://www.electron.build/> (section "Code Signing").
