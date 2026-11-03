# Releases

Builds contain no Yandex application ID or secret and the release workflow needs none: each user
registers their own application, see [SIGN_IN.en.md](SIGN_IN.en.md).

## Making a release

1. Update `version` in `package.json`, and `CHANGELOG.en.md` / `CHANGELOG.md`.
2. `npm run check` must pass.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
4. The **Release** workflow builds on Linux (AppImage, deb, rpm), macOS (dmg and zip, x64 and arm64) and
   Windows (installer and portable) and attaches everything to a **draft** release. Review the
   artifacts, then publish the draft.

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
