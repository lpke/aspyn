import { register, type HandlerContext } from "./registry.js";

register({
  name: "http",
  sideEffectDefault: true,

  async run(_ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = (typeof input === "string" ? { url: input } : input) as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };

    const method = (opts.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = { ...opts.headers };

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      bodyStr = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      headers["content-type"] ??= "application/json";
    }

    const res = await fetch(opts.url, {
      method,
      headers,
      body: bodyStr,
    });

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
