import type { TypedSourceHandler, GlobalConfig } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";
import { logger as globalLogger } from "../../logger.js";
import { httpSource } from "./http.js";
import { fileSource } from "./file.js";
import { shellSource } from "./shell.js";
import { webpageSource } from "./webpage.js";

export async function resolveSource(
  handler: TypedSourceHandler,
  cwd: string,
  timeout: number,
  globalConfig: GlobalConfig,
  log?: Logger,
): Promise<StepOutput> {
  const logger = log ?? globalLogger;
  switch (handler.type) {
    case "http":
      return httpSource(handler.input, logger);
    case "file":
      return fileSource(handler.input, cwd, logger);
    case "shell":
      return shellSource(handler.input, cwd, timeout, logger);
    case "webpage":
      return webpageSource(handler.input, globalConfig.playwright, logger);
    default: {
      const exhaustive: never = handler;
      throw new Error(
        `Unknown source type: ${(exhaustive as TypedSourceHandler).type}`,
      );
    }
  }
}
