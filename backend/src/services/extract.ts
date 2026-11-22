import path from 'node:path';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { config } from '../config';
import { HttpError } from '../errors';

export interface Extracted {
  kind: 'text' | 'image';
  name: string;
  mime: string;
  text?: string;
  dataUrl?: string;
  note?: string;
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
const ZIP_TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.kt', '.kts',
  '.php', '.yml', '.yaml', '.xml', '.gradle', '.sql', '.sh', '.toml', '.csv', '.properties',
]);

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

function magicOk(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case '.pdf': return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    case '.docx':
    case '.zip': return startsWith(buf, [0x50, 0x4b]);
    case '.png': return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case '.jpg':
    case '.jpeg': return startsWith(buf, [0xff, 0xd8, 0xff]);
    case '.gif': return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case '.webp': return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    default: return !buf.includes(0); // teks tidak boleh mengandung NUL
  }
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

export async function extractUpload(originalName: string, buf: Buffer): Promise<Extracted> {
  const name = path.basename(originalName).replace(/[\u0000-\u001f]/g, '').slice(0, 100) || 'file';
  const ext = path.extname(name).toLowerCase();
  const allowed = new Set(['.txt', '.md', '.json', '.pdf', '.docx', '.zip', ...Object.keys(IMAGE_MIME)]);
  if (!allowed.has(ext)) throw new HttpError(415, 'Tipe file tidak didukung (TXT, MD, JSON, PDF, DOCX, ZIP, gambar)');
  if (!buf.length) throw new HttpError(400, 'File kosong');
  if (!magicOk(ext, buf)) throw new HttpError(400, 'Isi file tidak cocok dengan ekstensinya');

  if (IMAGE_MIME[ext]) {
    const mime = IMAGE_MIME[ext];
    return { kind: 'image', name, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  }

  let raw = '';
  let note: string | undefined;
  if (ext === '.pdf') {
    try {
      raw = (await pdfParse(buf)).text.trim();
    } catch {
      throw new HttpError(422, 'PDF tidak dapat dibaca');
    }
    if (!raw) note = 'PDF tidak berisi teks yang dapat diekstrak (mungkin hasil scan).';
  } else if (ext === '.docx') {
    try {
      raw = (await mammoth.extractRawText({ buffer: buf })).value.trim();
    } catch {
      throw new HttpError(422, 'DOCX tidak dapat dibaca');
    }
  } else if (ext === '.zip') {
    raw = readZip(buf);
  } else {
    raw = buf.toString('utf8');
  }

  const { text, truncated } = clip(raw, config.maxAttachmentChars);
  if (truncated) note = 'Isi file dipotong karena terlalu panjang.';
  return { kind: 'text', name, mime: 'text/plain', text, note };
}

function readZip(buf: Buffer): string {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new HttpError(422, 'ZIP tidak dapat dibaca');
  }
  const entries = zip.getEntries();
  if (entries.length > 1000) throw new HttpError(413, 'ZIP berisi terlalu banyak file');
  const declared = entries.reduce((s, e) => s + e.header.size, 0);
  if (declared > config.maxZipUncompressedBytes) throw new HttpError(413, 'Ukuran ZIP setelah diekstrak terlalu besar');

  const listing: string[] = [];
  const bodies: string[] = [];
  let budget = config.maxAttachmentChars;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const n = e.entryName;
    if (n.startsWith('/') || n.includes('..') || n.includes('\\') || n.includes('\0')) continue; // tidak pernah diekstrak ke disk
    listing.push(`${n} (${e.header.size} B)`);
    if (budget > 0 && ZIP_TEXT_EXT.has(path.extname(n).toLowerCase()) && e.header.size <= 200_000) {
      const data = e.getData();
      if (data.includes(0)) continue;
      const s = data.toString('utf8').slice(0, budget);
      budget -= s.length;
      bodies.push(`--- ${n} ---\n${s}`);
    }
  }
  return `Daftar isi ZIP:\n${listing.join('\n')}\n\n${bodies.join('\n\n')}`;
}
