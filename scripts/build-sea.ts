import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import seaConfigJson from '../sea-config.json' with { type: 'json' };

// get current machine info
const platform = process.platform;
const architecture = process.arch;

// no windows
if (platform === 'win32') {
  process.stderr.write('ERROR: aspyn does not support Windows.\n');
  process.exit(1);
}

// expand `output` path in `/sea-config.json`
const seaConfig = seaConfigJson;
seaConfig.output = seaConfig.output
  .replaceAll('{platform}', platform)
  .replaceAll('{architecture}', architecture);

// helper: run a shell command, print output, handle errors
function shell(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    const displayCommand = [command, ...args].join(' ');
    process.stderr.write(`ERROR: command failed > ${displayCommand}\n`);
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// build the aspyn bundle that will go into the SEA
shell('pnpm', ['build:sea:bundle']);

const targetDir = dirname(seaConfig.output);
const generatedConfigPath = join(
  tmpdir(),
  `aspyn-sea-config-${process.pid}.json`,
);

mkdirSync(targetDir, { recursive: true });
rmSync(seaConfig.output, { force: true });

writeFileSync(generatedConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);

try {
  shell('node', ['--build-sea', generatedConfigPath]);
} finally {
  rmSync(generatedConfigPath, { force: true });
}

chmodSync(seaConfig.output, 0o755);
