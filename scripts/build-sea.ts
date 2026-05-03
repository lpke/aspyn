import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const platform = process.platform;
const architecture = process.arch;

if (platform === 'win32') {
  throw new Error('aspyn does not support Windows SEA builds.');
}

function expandTargetPath(path: string): string {
  return path
    .replaceAll('{platform}', platform)
    .replaceAll('{architecture}', architecture);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', ['build:sea:bundle']);

const seaConfig = JSON.parse(
  readFileSync('sea-config.json', 'utf8'),
) as SeaConfig;
const output = expandTargetPath(seaConfig.output);
const targetDir = dirname(output);
const generatedConfigPath = join(
  tmpdir(),
  `aspyn-sea-config-${process.pid}.json`,
);

mkdirSync(targetDir, { recursive: true });
rmSync(output, { force: true });

writeFileSync(
  generatedConfigPath,
  `${JSON.stringify({ ...seaConfig, output }, null, 2)}\n`,
);

try {
  run('node', ['--build-sea', generatedConfigPath]);
} finally {
  rmSync(generatedConfigPath, { force: true });
}

chmodSync(output, 0o755);

type SeaConfig = {
  main: string;
  output: string;
  disableExperimentalSEAWarning: boolean;
  useCodeCache: boolean;
  useSnapshot: boolean;
};
