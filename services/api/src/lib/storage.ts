import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config.ts';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  readonly kind: 'local' | 's3';
}

class LocalStorage implements Storage {
  readonly kind = 'local' as const;
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Clave de almacenamiento no válida');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Storage implements Storage {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly cfg: Config;
  constructor(cfg: Config) {
    this.cfg = cfg;
    this.client = new S3Client({
      region: cfg.S3_REGION,
      ...(cfg.S3_ENDPOINT ? { endpoint: cfg.S3_ENDPOINT } : {}),
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      ...(cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }),
    );
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }
}

export function createStorage(cfg: Config): Storage {
  return cfg.STORAGE_DRIVER === 's3' ? new S3Storage(cfg) : new LocalStorage(cfg.STORAGE_LOCAL_DIR);
}
