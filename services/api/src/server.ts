import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const cfg = loadConfig();
// In development the job processor runs inside the API unless WORKER_MODE=separate.
const inlineWorker = cfg.NODE_ENV !== 'production' && process.env.WORKER_MODE !== 'separate';
const { app, close } = await buildApp({ cfg, inlineWorker });
const shutdown = async (signal: string) => {
  app.log.info(`${signal} recibido, cerrando…`);
  await close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
await app.listen({ port: cfg.API_PORT, host: '0.0.0.0' });
app.log.info(`DressIt API en ${cfg.API_PUBLIC_URL} (docs: /docs)`);
