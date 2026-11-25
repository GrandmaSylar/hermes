import { buildApp } from './app';
import { loadConfig } from './config';
import { MssqlRepo } from './mssql-repo';

async function main() {
  const config = loadConfig();
  const repo = await MssqlRepo.connect(config.db);
  const app = buildApp({ config, repo });

  const stop = async () => {
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await app.listen({ port: config.port, host: config.host });
  console.log(`QSS field server listening on ${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error('Could not start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
