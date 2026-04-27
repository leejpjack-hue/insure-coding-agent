// Loads .env from the project root, regardless of the current working directory.
// Walks up from this file until a package.json is found and treats that as root.
//
// Import this module before any other module that reads process.env (config, llm-client).

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

function findProjectRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = findProjectRoot(here);
const envPath = path.join(projectRoot, '.env');

if (fs.existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

export { projectRoot, envPath };
