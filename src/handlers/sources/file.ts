import { readFile, stat } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import type { FileSourceInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";

export async function fileSource(
  input: FileSourceInput,
  cwd: string,
): Promise<StepOutput> {
  const { path: filePath, encoding = "utf-8" } = input;

  const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);

  const content = await readFile(resolved, encoding as BufferEncoding);
  const stats = await stat(resolved);

  return {
    content,
    path: resolved,
    modifiedAt: stats.mtime.toISOString(),
  };
}
