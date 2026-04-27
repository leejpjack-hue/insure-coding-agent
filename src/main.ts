import { loadConfig } from './core/config.js';
import { createServer } from './server/index.js';
import { initDatabase } from './core/database.js';

const config = loadConfig();
const { app, orchestrator } = createServer(config);
const db = initDatabase(config.dbPath);

app.listen(config.port, config.host, () => {
  console.log(`InsureAgent server running on http://${config.host}:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`API: http://${config.host}:${config.port}/api/health`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  orchestrator.close();
  db.close();
  process.exit(0);
});
