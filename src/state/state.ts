import fs from "node:fs/promises";
import fss from "node:fs";

import type { PipelineState } from "../types/state.js";
import { stateDir, stateJsonPath } from "../paths.js";

export async function readState(
  pipelineName: string,
): Promise<PipelineState | null> {
  const filePath = stateJsonPath(pipelineName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PipelineState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeState(
  pipelineName: string,
  state: PipelineState,
): Promise<void> {
  const dir = stateDir(pipelineName);
  await fs.mkdir(dir, { recursive: true });

  const filePath = stateJsonPath(pipelineName);
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function clearState(
  pipelineName: string,
  step?: string,
): Promise<void> {
  if (step == null) {
    const filePath = stateJsonPath(pipelineName);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return;
  }

  const state = await readState(pipelineName);
  if (!state) return;

  delete state.lastValues[step];
  await writeState(pipelineName, state);
}
