import os from 'node:os';
import path from 'node:path';
import {
  APP_NAME,
  CONFIG_FILE,
  STATE_FILE,
  STATE_HISTORY_FILE,
  RUN_LOCK_FILE,
  CONCURRENCY_LOCK_FILE,
  RUN_LOG_FILE,
  ACTION_LOG_FILE,
  CONTEXT_FILE,
} from './constants.js';

export function configRoot(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg
    ? path.join(xdg, APP_NAME)
    : path.join(os.homedir(), '.config', APP_NAME);
}

export function dataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME;
  return xdg
    ? path.join(xdg, APP_NAME)
    : path.join(os.homedir(), '.local', 'share', APP_NAME);
}

export function globalConfigPath(): string {
  return path.join(configRoot(), CONFIG_FILE);
}

export function pipelineConfigDir(name: string): string {
  return path.join(configRoot(), name);
}

export function pipelineConfigPath(name: string): string {
  return path.join(pipelineConfigDir(name), CONFIG_FILE);
}

export function pipelineDataDir(name: string): string {
  return path.join(dataRoot(), name);
}

export function stateDir(name: string): string {
  return path.join(pipelineDataDir(name), 'state');
}

export function logsDir(name: string): string {
  return path.join(pipelineDataDir(name), 'logs');
}

export function stateJsonPath(name: string): string {
  return path.join(stateDir(name), STATE_FILE);
}

export function stateHistoryPath(name: string): string {
  return path.join(stateDir(name), STATE_HISTORY_FILE);
}

export function runLockPath(name: string): string {
  return path.join(stateDir(name), RUN_LOCK_FILE);
}

export function concurrencyLockPath(name: string): string {
  return path.join(stateDir(name), CONCURRENCY_LOCK_FILE);
}

export function runLogPath(name: string): string {
  return path.join(logsDir(name), RUN_LOG_FILE);
}

export function actionLogPath(name: string): string {
  return path.join(logsDir(name), ACTION_LOG_FILE);
}

export function contextFilePath(name: string): string {
  return path.join(stateDir(name), CONTEXT_FILE);
}
