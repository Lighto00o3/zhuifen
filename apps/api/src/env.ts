import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const developmentPath = resolve(__dirname, '../.env');
config({ path: existsSync(developmentPath) ? developmentPath : resolve(__dirname, '../../.env'), quiet: true });
// 允许写成 "a.com, b.com"，逗号后的空格不影响匹配。
export const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(origin => origin.trim()).filter(Boolean);
