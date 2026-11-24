import { createHmac, timingSafeEqual } from 'node:crypto';

export type ImageVariant = 'original' | 'cutout' | 'thumb';

/**
 * Short-lived HMAC-signed URLs for private images, so image components don't need
 * auth headers. The owner id is part of the signed payload and is used to open an
 * RLS-scoped transaction when serving the file.
 */
export class UrlSigner {
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly ttlSeconds: number;
  constructor(secret: string, baseUrl: string, ttlSeconds = 12 * 3600) {
    this.secret = secret;
    this.baseUrl = baseUrl;
    this.ttlSeconds = ttlSeconds;
  }
  private mac(userId: string, id: string, variant: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${userId}:${id}:${variant}:${exp}`).digest('base64url');
  }
  sign(userId: string, imageId: string, variant: ImageVariant, now = Date.now()): string {
    // Round expiry up to the hour so URLs stay stable (cache-friendly) within the hour.
    const exp = Math.ceil((now / 1000 + this.ttlSeconds) / 3600) * 3600;
    return `${this.baseUrl}/v1/images/${imageId}?v=${variant}&u=${userId}&exp=${exp}&sig=${this.mac(userId, imageId, variant, exp)}`;
  }
  verify(userId: string, imageId: string, variant: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < now) return false;
    const expected = Buffer.from(this.mac(userId, imageId, variant, exp));
    const got = Buffer.from(sig);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
}
