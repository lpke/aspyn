import { register, type HandlerContext } from './registry.js';
import { DEFAULT_TIMEOUT_SECONDS } from '../constants.js';
import { parseDurationMs } from '../duration.js';

register({
  name: 'http',
  sideEffectDefault: true,

  async run(_ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = (typeof input === 'string' ? { url: input } : input) as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      throwOnError?: boolean;
      timeout?: string | number;
    };

    const method = (opts.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = { ...opts.headers };

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      bodyStr =
        typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }

    const timeoutMs =
      opts.timeout !== undefined
        ? parseDurationMs(opts.timeout)
        : DEFAULT_TIMEOUT_SECONDS * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(opts.url, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `http: ${method} ${opts.url} timed out after ${timeoutMs}ms`,
        );
      }
      throw err;
    }
    clearTimeout(timer);

    if (opts.throwOnError === true && res.status >= 400) {
      throw new Error(
        `http: ${method} ${opts.url} failed with status ${res.status}`,
      );
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    return { status: res.status, headers: responseHeaders, body };
  },
});
