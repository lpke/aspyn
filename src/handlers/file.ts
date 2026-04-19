import { readFile, stat } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { register, type HandlerContext } from "./registry.js";

register({
  name: "file",
  async run(_ctx: HandlerContext, input: unknown) {
    const { path: filePath, encoding = "utf-8" } = input as {
      path: string;
      encoding?: string;
    };

    const resolved = isAbsolute(filePath) ? filePath : resolve(filePath);
    const content = await readFile(resolved, encoding as BufferEncoding);
    const stats = await stat(resolved);

    return {
      content,
      path: resolved,
      modifiedAt: stats.mtime.toISOString(),
    };
  },
});
