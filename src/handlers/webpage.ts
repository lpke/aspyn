import { register, type HandlerContext } from "./registry.js";
import { DEFAULT_TIMEOUT_SECONDS } from "../constants.js";

register({
  name: "webpage",
  async run(_ctx: HandlerContext, input: unknown) {
    const { url, waitFor, timeout, javascript } = input as {
      url: string;
      waitFor?: string;
      timeout?: number;
      javascript?: string;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pw: any;
    try {
      const mod = "playwright";
      pw = await import(/* webpackIgnore: true */ mod);
    } catch {
      throw new Error("Playwright is not installed");
    }

    const browser = await pw.chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(url);

      if (waitFor) {
        await page.waitForSelector(waitFor, {
          timeout: (timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
        });
      }

      if (javascript) {
        await page.evaluate(javascript);
      }

      const html: string = await page.content();
      const finalUrl: string = page.url();

      return { html, url: finalUrl };
    } finally {
      await browser.close();
    }
  },
});
