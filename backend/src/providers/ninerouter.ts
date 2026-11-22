import { config } from '../config';
import { UpstreamError } from '../errors';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ModelInfo {
  id: string;
  owned_by: string;
  isCombo: boolean;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.nineRouterApiKey) h.Authorization = `Bearer ${config.nineRouterApiKey}`;
  return h;
}

async function failure(res: Response): Promise<UpstreamError> {
  let text = await res.text().catch(() => '');
  if (config.nineRouterApiKey) text = text.split(config.nineRouterApiKey).join('***');
  return new UpstreamError(res.status, text.slice(0, 300));
}

/** GET {base}/models — endpoint OpenAI-compatible milik 9Router. Combo memiliki owned_by "combo". */
export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${config.nineRouterBaseUrl}/models`, {
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
  return (json.data ?? [])
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({ id: m.id!, owned_by: m.owned_by ?? '', isCombo: m.owned_by === 'combo' }));
}

/** POST {base}/chat/completions dengan stream:true. Fallback antar model dilakukan oleh Combo di 9Router. */
export async function* streamChat(opts: {
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): AsyncGenerator<string> {
  const res = await fetch(`${config.nineRouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw await failure(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.error) {
          throw new UpstreamError(502, String(json.error.message ?? 'stream error').slice(0, 300));
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
