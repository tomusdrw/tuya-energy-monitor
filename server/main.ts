import { loadConfig } from './config.js';
import { createApp } from './app.js';

try {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen({ port: config.port, host: config.host });
  console.log(`Tuya Energy Monitor is listening at ${config.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Startup failed');
  process.exit(1);
}
