// CSP headers
export const CSP_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
};

// Electron security defaults
export const ELECTRON_SECURITY = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const;

// Allowed external domains
export const ALLOWED_EXTERNAL_DOMAINS = [
  'yandex.ru',
  'yandex.com',
  'yadi.sk',
  'cloud-api.yandex.net',
];
