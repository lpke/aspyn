import notifier from "node-notifier";
import type { Logger } from "../../logger.js";
import { logger as globalLogger } from "../../logger.js";
import type { DesktopActionInput } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { expandTemplates } from "../template.js";

export async function desktopAction(
  input: DesktopActionInput,
  context: PipelineContext,
  log?: Logger,
): Promise<void> {
  const logger = log ?? globalLogger;
  const title = input.title
    ? (expandTemplates(input.title, context) as string)
    : "aspyn";
  const message = input.message
    ? (expandTemplates(input.message, context) as string)
    : "";

  const ENOENT_WARNING =
    "Desktop notifications require 'notify-send' (libnotify) on Linux. Notification skipped.";

  try {
    return await new Promise<void>((resolve, reject) => {
      notifier.notify(
        { title, message, sound: input.sound ?? false },
        (err: Error | null) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              logger.warn(ENOENT_WARNING);
              resolve();
            } else {
              reject(err);
            }
          } else {
            resolve();
          }
        },
      );
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      logger.warn(ENOENT_WARNING);
      return;
    }
    throw error;
  }
}
