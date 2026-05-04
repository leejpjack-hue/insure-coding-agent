import "./core/env.js";
import { loadConfig } from './core/config.js';
import { createServer } from './server/index.js';
import { initDatabase } from './core/database.js';
import { MemoryManager } from './core/memory.js';
import { SkillGenerator } from './core/skill-generator.js';

const config = loadConfig();
const { app, orchestrator } = createServer(config);
const db = initDatabase(config.dbPath);
const memoryManager = new MemoryManager(config.dbPath.replace(/\.db$/i, '') + 'memory.json');
const skillGenerator = new SkillGenerator();

app.listen(config.port, config.host, () => {
  console.log(`InsureAgent server running on http://${config.host}:${config.port}`);
  console.log(`Database: ${config.dbPath.replace(/\.db$/i, '.json')}`);
  console.log(`Memory: ${config.dbPath.replace(/\.db$/i, '')}memory.json`);
  console.log(`API: http://${config.host}:${config.port}/api/health`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  orchestrator.close();
  db.close();
  memoryManager.close();
  process.exit(0);
});
