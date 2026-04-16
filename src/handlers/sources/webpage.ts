import type { WebpageSourceInput, GlobalConfig } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";

export async function webpageSource(
  input: WebpageSourceInput,
  playwrightConfig?: GlobalConfig["playwright"],
  _log?: Logger,
): Promise<StepOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pw: any;
  try {
    const mod = "playwright";
    pw = await import(/* webpackIgnore: true */ mod);
  } catch {
    throw new Error(
      "Playwright is not installed. Run: pnpm exec playwright install",
    );
  }

  const browserType = playwrightConfig?.browser ?? "chromium";
  const headless = playwrightConfig?.headless ?? true;

  const browser = await pw[browserType].launch({ headless });

  try {
    const page = await browser.newPage();
    await page.goto(input.url);

    if (input.waitFor) {
      await page.waitForSelector(input.waitFor, {
        timeout: input.timeout ?? 30_000,
      });
    }

    const html: string = await page.content();
    const finalUrl: string = page.url();

    return {
      html,
      url: finalUrl,
    };
  } finally {
    await browser.close();
  }
}
