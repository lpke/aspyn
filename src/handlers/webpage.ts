import { register, type HandlerContext } from './registry.js';
import { DEFAULT_TIMEOUT_SECONDS } from '../constants.js';
import { parseDurationMs } from '../duration.js';
import { loadGlobalConfig } from '../config/loader.js';

register({
  name: 'webpage',
  async run(_ctx: HandlerContext, input: unknown) {
    const { url, waitFor, timeout, javascript } = input as {
      url: string;
      waitFor?: string;
      timeout?: string | number;
      javascript?: string;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pw: any;
    try {
      const mod = 'playwright';
      pw = await import(/* webpackIgnore: true */ mod);
    } catch {
      throw new Error('Playwright is not installed');
    }

    const globalCfg = await loadGlobalConfig();
    const browserType = globalCfg.playwright?.browser ?? 'chromium';
    const headless = globalCfg.playwright?.headless ?? true;
    const browser = await pw[browserType].launch({ headless });

    try {
      const page = await browser.newPage();
      await page.goto(url);

      if (waitFor) {
        const waitTimeoutMs =
          timeout !== undefined
            ? parseDurationMs(timeout)
            : DEFAULT_TIMEOUT_SECONDS * 1000;
        await page.waitForSelector(waitFor, { timeout: waitTimeoutMs });
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
