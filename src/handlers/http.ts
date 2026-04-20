import { register, type HandlerContext } from './registry.js';

register({
  name: 'http',
  sideEffectDefault: true,

  async run(ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = (typeof input === 'string' ? { url: input } : input) as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      throwOnError?: boolean;
    };

    const method = (opts.method ?? 'GET').toUpperCase();

    // Normalise header keys to lowercase (Issue 3)
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      bodyStr =
        typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(opts.url, {
        method,
        headers,
        body: bodyStr,
        signal: ctx.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `http: ${method} ${opts.url} timed out`,
        );
      }
      throw err;
    }

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
