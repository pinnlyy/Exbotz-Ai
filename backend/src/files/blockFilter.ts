import { HttpError } from '../errors';

export type BlockEvent =
  | { type: 'text'; text: string }
  | { type: 'file_start'; path: string }
  | { type: 'file'; path: string; content: string }
  | { type: 'zip'; name: string; dir: string };

const OPEN = '<exbotz-';

function partialLen(buf: string): number {
  for (let k = Math.min(OPEN.length - 1, buf.length); k > 0; k--) {
    if (buf.endsWith(OPEN.slice(0, k))) return k;
  }
  return 0;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

/**
 * Memisahkan teks chat biasa dari blok <exbotz-file> / <exbotz-zip> yang dihasilkan AI,
 * secara streaming (aman terhadap tag yang terpotong di antara chunk).
 */
export class BlockFilter {
  private buf = '';
  private cur: { name: 'file' | 'zip'; attrs: Record<string, string> } | null = null;

  constructor(private maxBlock: number) {}

  push(chunk: string): BlockEvent[] {
    this.buf += chunk;
    return this.drain();
  }

  private drain(): BlockEvent[] {
    const out: BlockEvent[] = [];
    for (;;) {
      if (!this.cur) {
        const i = this.buf.indexOf(OPEN);
        if (i === -1) {
          const cut = this.buf.length - partialLen(this.buf);
          if (cut > 0) out.push({ type: 'text', text: this.buf.slice(0, cut) });
          this.buf = this.buf.slice(cut);
          return out;
        }
        if (i > 0) {
          out.push({ type: 'text', text: this.buf.slice(0, i) });
          this.buf = this.buf.slice(i);
        }
        const end = this.buf.indexOf('>');
        if (end === -1) {
          if (this.buf.length > 2000) {
            out.push({ type: 'text', text: '<' });
            this.buf = this.buf.slice(1);
            continue;
          }
          return out;
        }
        let head = this.buf.slice(1, end);
        const selfClose = head.endsWith('/');
        if (selfClose) head = head.slice(0, -1);
        const m = /^exbotz-(file|zip)(?=\s|$)([\s\S]*)$/.exec(head);
        if (!m) {
          out.push({ type: 'text', text: '<' });
          this.buf = this.buf.slice(1);
          continue;
        }
        const name = m[1] as 'file' | 'zip';
        const attrs = parseAttrs(m[2]);
        this.buf = this.buf.slice(end + 1);
        if (selfClose) {
          if (name === 'zip') out.push({ type: 'zip', name: attrs.name ?? '', dir: attrs.dir ?? '' });
          else if (attrs.path) out.push({ type: 'file', path: attrs.path, content: '' });
          continue;
        }
        this.cur = { name, attrs };
        if (name === 'file' && attrs.path) out.push({ type: 'file_start', path: attrs.path });
      } else {
        const close = `</exbotz-${this.cur.name}>`;
        const j = this.buf.indexOf(close);
        if (j === -1) {
          if (this.buf.length > this.maxBlock) throw new HttpError(413, 'File yang dihasilkan terlalu besar');
          return out;
        }
        const content = this.buf.slice(0, j);
        const { name, attrs } = this.cur;
        this.buf = this.buf.slice(j + close.length);
        this.cur = null;
        if (name === 'file') {
          if (attrs.path) out.push({ type: 'file', path: attrs.path, content });
        } else {
          out.push({ type: 'zip', name: attrs.name ?? '', dir: attrs.dir ?? '' });
        }
      }
    }
  }

  end(): BlockEvent[] {
    if (this.cur) {
      const p = this.cur.attrs.path ?? this.cur.attrs.name ?? '';
      this.cur = null;
      this.buf = '';
      return [{ type: 'text', text: `\n\n⚠️ Output terpotong sebelum selesai, file ${p} tidak disimpan.` }];
    }
    const rest = this.buf;
    this.buf = '';
    return rest ? [{ type: 'text', text: rest }] : [];
  }
}
