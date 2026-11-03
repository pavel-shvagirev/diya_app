import fs from 'fs';
import path from 'path';

export interface TokenCrypto {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

export interface Session {
  accessToken: string;
  refreshToken?: string;
}

/** Persists the OAuth session encrypted (Electron safeStorage in production). */
export class TokenStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: TokenCrypto
  ) {}

  save(session: Session): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, this.crypto.encrypt(JSON.stringify({ v: 1, ...session })), {
      mode: 0o600,
    });
  }

  load(): Session | null {
    try {
      const plain = this.crypto.decrypt(fs.readFileSync(this.filePath, 'utf8'));
      if (!plain) return null;
      try {
        const parsed = JSON.parse(plain) as {
          v?: number;
          accessToken?: unknown;
          refreshToken?: unknown;
        };
        if (parsed && typeof parsed === 'object' && typeof parsed.accessToken === 'string') {
          return {
            accessToken: parsed.accessToken,
            ...(typeof parsed.refreshToken === 'string'
              ? { refreshToken: parsed.refreshToken }
              : {}),
          };
        }
      } catch {
        // an older build stored the bare token string
      }
      return { accessToken: plain };
    } catch {
      return null;
    }
  }

  clear(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}

/** One small secret (the application's client secret) in an encrypted file. */
export class SecretFile {
  constructor(
    private readonly filePath: string,
    private readonly crypto: TokenCrypto
  ) {}

  get(): string {
    try {
      return this.crypto.decrypt(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return '';
    }
  }

  /** Throws when the OS offers no encryption: the caller then keeps the secret in memory only. */
  set(secret: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, this.crypto.encrypt(secret), { mode: 0o600 });
  }

  clear(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}
