import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const app = buildApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => { app.log.error(error); process.exitCode = 1; });
  });
}

try {
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
} catch (error: unknown) {
  app.log.error(error);
  process.exitCode = 1;
}
