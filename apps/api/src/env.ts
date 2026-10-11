import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const developmentPath = resolve(__dirname, '../.env');
config({ path: existsSync(developmentPath) ? developmentPath : resolve(__dirname, '../../.env'), quiet: true });
