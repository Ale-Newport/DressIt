import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV = 'test';
// Never run tests against the development database.
if (process.env.DATABASE_TEST_URL) process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
if (process.env.DATABASE_TEST_ADMIN_URL) process.env.DATABASE_ADMIN_URL = process.env.DATABASE_TEST_ADMIN_URL;
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.IMAGE_URL_SECRET ??= 'test-image-secret-test-image-secret-123';
