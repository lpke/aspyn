import os from "node:os";
import path from "node:path";

function home(): string {
  return os.homedir();
}

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? path.join(xdg, "aspyn") : path.join(home(), ".config", "aspyn");
}

export function getDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  return xdg
    ? path.join(xdg, "aspyn")
    : path.join(home(), ".local", "share", "aspyn");
}

export function getStateDir(): string {
  return path.join(getDataDir(), "state");
}

export function getLogDir(): string {
  return path.join(getDataDir(), "logs");
}

export function getGlobalConfigPath(): string {
  return path.join(getConfigDir(), "config.jsonc");
}

export function getWatchDir(name: string): string {
  return path.join(getConfigDir(), name);
}

export function getWatchConfigPath(name: string): string {
  return path.join(getWatchDir(name), "config.jsonc");
}

export function getWatchStateDir(name: string): string {
  return path.join(getStateDir(), name);
}

export function getWatchLogDir(name: string): string {
  return path.join(getLogDir(), name);
}

export function getStatePath(name: string): string {
  return path.join(getWatchStateDir(name), "state.json");
}

export function getLockPath(name: string): string {
  return path.join(getWatchStateDir(name), "lock");
}

export function getStateHistoryPath(name: string): string {
  return path.join(getWatchStateDir(name), "state-history.jsonl");
}

export function getActionLogPath(name: string): string {
  return path.join(getWatchLogDir(name), "action.log");
}

export function getRunLogPath(name: string): string {
  return path.join(getWatchLogDir(name), "run.log");
}

