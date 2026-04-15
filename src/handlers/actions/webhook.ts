import type { WebhookActionInput } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { expandTemplates } from "../template.js";

export async function webhookAction(
  input: WebhookActionInput,
  context: PipelineContext,
): Promise<void> {
  const method = input.method ?? "POST";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...input.headers,
  };

  const body = input.body
    ? expandTemplates(input.body, context)
    : context;

  const response = await fetch(input.url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (response.ok) {
    console.error(`[webhook] ${method} ${input.url} → ${response.status}`);
  } else {
    console.error(
      `[webhook] ${method} ${input.url} → ${response.status} (non-2xx)`,
    );
  }
}
