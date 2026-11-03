# Signing in: your own Yandex application

Diya contains no Yandex application ID, secret or token. Yandex gives Disk access only to
registered OAuth applications: register your own, once. The app then works
with your own Disk, and you are the owner of the application under the
[API terms](https://yandex.ru/legal/disk_api/).

## 1. Create the application

Official guides: [register an app](https://yandex.com/dev/id/doc/en/register-api) and
[access to the Disk API](https://yandex.com/dev/disk-api/doc/en/concepts/quickstart#oauth).

1. Open <https://oauth.yandex.com/client/new/> (<https://oauth.yandex.ru/client/new/> in the Russian
   interface) and sign in with the account whose Disk you want to use.
2. Type: **For API access or debugging**. Name and contact e-mail: yours (the name is only shown to you).
3. Permissions (Yandex Disk REST API): `cloud_api:disk.read`, `cloud_api:disk.write`,
   `cloud_api:disk.info`. (`cloud_api:disk.app_folder` is not needed.)
4. Create the app. Yandex shows two values: the **ID** (`ClientID`) and the **password**
   (`Client secret`). Copy both. The device flow needs both values to issue a token; the token route
   below needs neither in the app.

The sign-in screen has an **Open app creation** button and the same steps.

## 2. Sign in

Paste the ID and the secret into **Client ID** and **Client secret** and press **Save**. The secret is
stored encrypted with the OS keystore in `client-secret.bin` (without a keystore it is kept for the
session only), is never shown again and is sent only to Yandex. Then either:

- **Sign in with Yandex** — the app shows a code (and copies it), opens the Yandex page
  "Device authorization"; paste the code there and allow access. This is Yandex's _device flow_
  ([description](https://yandex.com/dev/id/doc/en/codes/screen-code-oauth)).
  "invalid_client" means the ID and the secret do not belong to the same application.
- **Token** — press **Open the token page**, allow access, copy the token from the address of the
  page that opens (after `access_token=` up to `&`) and paste it into the token field; pasting the
  whole address also works. This is Yandex's
  [manual token](https://yandex.com/dev/id/doc/en/tokens/debug-token) and always works for an
  application of the type above.

A manually obtained token has a fixed lifetime (`expires_in` on that page) and no refresh token;
after it expires the app asks to sign in again.

## Revoking and removing

- Revoke the app's access in your Yandex ID settings (applications with access to your account),
  or delete the application at <https://oauth.yandex.com/>.
- **Sign out** in Diya's settings deletes the stored token. See
  [where the data lives](../README.en.md#where-the-app-keeps-its-data).

## For developers

`YADISK_CLIENT_ID=<id> npm start` supplies the ID without typing it; `YADISK_CLIENT_SECRET` does the
same for the secret. What you type on the screen wins over the variables. Release builds contain no ID; see [RELEASING.en.md](RELEASING.en.md).
