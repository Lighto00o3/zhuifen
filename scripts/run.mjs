import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const localNode = resolve('.tools/node_modules/node/bin/node');
const runtime = existsSync(localNode) ? localNode : process.execPath;
const child = spawn(runtime, [process.env.npm_execpath, 'run', `${process.argv[2]}:internal`], {
  stdio: 'inherit', env: { ...process.env, PATH: `${dirname(runtime)}:${process.env.PATH}` },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
