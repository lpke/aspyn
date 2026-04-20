import { register, type HandlerContext } from './registry.js';
import { loadGlobalConfig } from '../config/loader.js';

register({
  name: 'webpage',
  async run(ctx: HandlerContext, input: unknown) {
    const { url, waitFor, javascript } = input as {
      url: string;
      waitFor?: string;
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

    // Close browser on abort
    const onAbort = () => {
      browser.close().catch(() => {});
    };
    if (ctx.signal.aborted) {
      await browser.close();
      throw new Error('webpage: aborted before navigation');
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const page = await browser.newPage();

      // Compute remaining deadline from the signal (AbortSignal.timeout stores it internally;
      // we can't extract it, but we can use a reasonable large default since the outer
      // withTimeout + signal will enforce the real deadline).
      // Playwright's default timeout applies to goto/waitForSelector/evaluate.
      const remainingMs = 30_000; // fallback; real enforcement is via the signal
      // If the signal has a reason with a timeout hint, we'd use it. For now, set a generous
      // playwright-internal timeout; the AbortSignal onAbort will hard-close the browser.
      page.setDefaultTimeout(remainingMs);

      await page.goto(url);

      if (waitFor) {
        await page.waitForSelector(waitFor);
      }

      if (javascript) {
        await page.evaluate(javascript);
      }

      const html: string = await page.content();
      const finalUrl: string = page.url();

      return { html, url: finalUrl };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      await browser.close().catch(() => {});
    }
  },
});
