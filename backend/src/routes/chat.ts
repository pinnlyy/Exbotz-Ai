import { Router, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { asyncHandler, HttpError, UpstreamError } from '../errors';
import { BlockFilter, type BlockEvent } from '../files/blockFilter';
import { createZip, workspaceContext, writeGenerated } from '../files/fileStore';
import { isValidId } from '../files/safePath';
import { streamChat, type ChatMessage, type ContentPart } from '../providers/ninerouter';
import { loadAttachment } from '../services/attachments';
import { SYSTEM_PROMPT } from '../services/prompt';

export const chatRouter = Router();

const bodySchema = z.object({
  conversationId: z.string().refine(isValidId),
  model: z.string().max(200).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(200_000),
        attachmentIds: z.array(z.string()).max(5).optional(),
      }),
    )
    .min(1)
    .max(500),
});

type Msg = z.infer<typeof bodySchema>['messages'][number];

async function toUpstream(convId: string, m: Msg): Promise<ChatMessage> {
  if (!m.attachmentIds?.length) return { role: m.role, content: m.content };
  let text = m.content;
  const images: ContentPart[] = [];
  for (const id of m.attachmentIds) {
    const a = await loadAttachment(convId, id);
    if (a.kind === 'image' && a.dataUrl) images.push({ type: 'image_url', image_url: { url: a.dataUrl } });
    else text += `\n\n[Lampiran: ${a.name}]\n\`\`\`\n${a.text ?? ''}\n\`\`\``;
  }
  if (!images.length) return { role: m.role, content: text };
  return { role: m.role, content: [{ type: 'text', text }, ...images] };
}

/** Potong riwayat dari yang paling lama agar muat di batas konteks (dukungan percakapan panjang). */
function fitContext(messages: Msg[]): Msg[] {
  let total = 0;
  const kept: Msg[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length;
    if (total > config.maxContextChars && kept.length > 0) break;
    kept.unshift(messages[i]);
  }
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  return kept;
}

function publicMessage(e: unknown): string {
  if (e instanceof UpstreamError) return `9Router mengembalikan error ${e.status}: ${e.detail}`;
  if (e instanceof HttpError) return e.message;
  if (e instanceof TypeError) return 'Tidak dapat terhubung ke 9Router';
  console.error(e);
  return 'Terjadi kesalahan pada server';
}

chatRouter.post(
  '/',
  asyncHandler(async (req, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Request tidak valid');
    const { conversationId } = parsed.data;
    const model = parsed.data.model || config.defaultModel;
    if (!model) throw new HttpError(400, 'Model/Combo belum dipilih dan NINEROUTER_DEFAULT_MODEL kosong');

    const history = fitContext(parsed.data.messages);
    const ws = await workspaceContext(conversationId);
    const upstream: ChatMessage[] = [
      { role: 'system', content: ws ? `${SYSTEM_PROMPT}\n\n${ws}` : SYSTEM_PROMPT },
      ...(await Promise.all(history.map((m) => toUpstream(conversationId, m)))),
    ];

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const hb = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    const filter = new BlockFilter(config.maxGeneratedFileBytes + 8192);
    const handle = async (ev: BlockEvent) => {
      try {
        if (ev.type === 'text') {
          if (ev.text) send('delta', { text: ev.text });
        } else if (ev.type === 'file_start') {
          send('file_start', { path: ev.path });
        } else if (ev.type === 'file') {
          send('file', { file: await writeGenerated(conversationId, ev.path, ev.content) });
        } else {
          send('file', { file: await createZip(conversationId, ev.dir || undefined, ev.name || undefined) });
        }
      } catch (e) {
        const p = ev.type === 'file' || ev.type === 'file_start' ? ev.path : ev.type === 'zip' ? ev.name : '';
        send('file_error', { path: p, message: e instanceof HttpError ? e.message : 'Gagal membuat file' });
      }
    };

    try {
      send('start', { model });
      for await (const chunk of streamChat({ model, messages: upstream, signal: ac.signal })) {
        for (const ev of filter.push(chunk)) await handle(ev);
      }
      for (const ev of filter.end()) await handle(ev);
      send('done', {});
    } catch (e) {
      if (!ac.signal.aborted) send('error', { message: publicMessage(e) });
    } finally {
      clearInterval(hb);
      res.end();
    }
  }),
);
