import notifier from "node-notifier";
import { register, type HandlerContext } from "./registry.js";
import { logger } from "../logger.js";

register({
  name: "notification-desktop",
  sideEffectDefault: true,

  async run(_ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = input as {
      title: string;
      body?: string;
      message?: string;
      sound?: boolean;
    };

    const message = opts.body ?? opts.message ?? "";

    return new Promise<unknown>((resolve) => {
      notifier.notify(
        {
          title: opts.title,
          message,
          sound: opts.sound ?? false,
        },
        (err: Error | null) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              logger.warn("notify-send not available — desktop notification skipped");
              resolve({ delivered: false, reason: "notify-send not available" });
              return;
            }
            throw err;
          }
          resolve({ delivered: true });
        },
      );
    });
  },
});
