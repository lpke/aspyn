import type { TypedActionHandler } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { webhookAction } from "./webhook.js";
import { desktopAction } from "./desktop.js";
import { shellAction } from "./shell.js";
import { logAction } from "./log.js";

export async function resolveAction(
  handler: TypedActionHandler,
  context: PipelineContext,
  cwd: string,
  watchName: string,
  defaultTimeout: number,
): Promise<void> {
  switch (handler.type) {
    case "webhook":
      return webhookAction(handler.input, context);
    case "desktop":
      return desktopAction(handler.input, context);
    case "shell":
      return shellAction(handler.input, context, cwd, defaultTimeout);
    case "log":
      return logAction(handler.input, context, watchName);
    default: {
      const exhaustive: never = handler;
      throw new Error(
        `Unknown action type: ${(exhaustive as TypedActionHandler).type}`,
      );
    }
  }
}
