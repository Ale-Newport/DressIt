import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { hash, verify } from '@node-rs/argon2';
import { unauthorized } from './errors.ts';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }
  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('dressit')
      .setAudience('dressit-app')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }
  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'dressit', audience: 'dressit-app', algorithms: ['HS256'] });
      if (!payload.sub) throw new Error('no sub');
      return payload.sub;
    } catch {
      throw unauthorized();
    }
  }
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

// OWASP 2025 recommendation for argon2id: m=19 MiB, t=2, p=1
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (hashed: string, pw: string) => verify(hashed, pw).catch(() => false);
