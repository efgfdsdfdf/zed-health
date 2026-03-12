// inject-env.js
// Reads ANTHROPIC_KEY from .env, injects it into dist/zed-core.js
// Run once before serving: node inject-env.js
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const key = process.env.ANTHROPIC_KEY;
if (!key) {
  console.error('❌  ANTHROPIC_KEY not found in .env');
  process.exit(1);
}

const srcFile = path.join(__dirname, 'zed-core.js');         // source with %%placeholder%%
const outFile = path.join(__dirname, 'dist', 'zed-core.js'); // served by HTML pages

let content = fs.readFileSync(srcFile, 'utf8');
if (!content.includes('%%ANTHROPIC_KEY%%')) {
  console.error('❌  Placeholder %%ANTHROPIC_KEY%% not found in zed-core.js');
  process.exit(1);
}

content = content.replace('%%ANTHROPIC_KEY%%', key);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content);
console.log('✅  dist/zed-core.js updated with API key');
