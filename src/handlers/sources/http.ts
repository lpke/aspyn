import type { HttpSourceInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";

export async function httpSource(input: HttpSourceInput, _log?: Logger): Promise<StepOutput> {
  const { url, method = "GET", headers, body } = input;

  const init: RequestInit = { method };

  if (headers) {
    init.headers = headers;
  }

  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(url, init);

  const text = await response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    body: parsed,
  };
}
