import type { TypedSourceHandler, GlobalConfig } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import { httpSource } from "./http.js";
import { fileSource } from "./file.js";
import { shellSource } from "./shell.js";
import { webpageSource } from "./webpage.js";

export async function resolveSource(
  handler: TypedSourceHandler,
  cwd: string,
  timeout: number,
  globalConfig: GlobalConfig,
): Promise<StepOutput> {
  switch (handler.type) {
    case "http":
      return httpSource(handler.input);
    case "file":
      return fileSource(handler.input, cwd);
    case "shell":
      return shellSource(handler.input, cwd, timeout);
    case "webpage":
      return webpageSource(handler.input, globalConfig.playwright);
    default: {
      const exhaustive: never = handler;
      throw new Error(
        `Unknown source type: ${(exhaustive as TypedSourceHandler).type}`,
      );
    }
  }
}
