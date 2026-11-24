/** Regenerates src/db/types.ts from the live schema (run after migrations). */
import { execFileSync } from 'node:child_process';
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
execFileSync('npx', ['kysely-codegen', '--dialect', 'postgres', '--url', url, '--out-file', 'src/db/types.ts', '--exclude-pattern', 'schema_migrations', '--numeric-parser', 'number', '--date-parser', 'string'], { stdio: 'inherit' });
