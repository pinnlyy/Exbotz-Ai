import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { config } from '../config';
import { HttpError } from '../errors';
import { isValidId, safeResolve } from './safePath';
import { renderDocx, renderPdf } from './render';

export interface FileInfo {
  path: string;
  size: number;
  modified: number;
  previewable: boolean;
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py',
  '.java', '.kt', '.kts', '.php', '.yml', '.yaml', '.xml', '.gradle', '.svg', '.sql', '.sh',
  '.toml', '.properties', '.csv', '.env.example', '.gitignore',
]);
const BINARY_EXT = new Set(['.pdf', '.docx', '.zip']);
const ALLOWED_BASENAMES = new Set(['.gitignore', '.env.example', 'dockerfile', 'license', 'readme', 'makefile']);

function extOf(rel: string): string {
  const base = path.posix.basename(rel).toLowerCase();
  if (ALLOWED_BASENAMES.has(base)) return base.startsWith('.') ? base : '.txt';
  return path.extname(base);
}

export const isAllowedName = (rel: string): boolean => {
  const base = path.posix.basename(rel).toLowerCase();
  if (ALLOWED_BASENAMES.has(base)) return true;
  const ext = path.extname(base);
  return TEXT_EXT.has(ext) || BINARY_EXT.has(ext);
};
export const isText = (rel: string): boolean => TEXT_EXT.has(extOf(rel));

export function convDir(convId: string): string {
  if (!isValidId(convId)) throw new HttpError(400, 'ID percakapan tidak valid');
  return path.join(config.dataDir, 'workspaces', convId);
}

async function walk(root: string, dir = root, out: FileInfo[] = []): Promise<FileInfo[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) await walk(root, abs, out);
    else if (e.isFile()) {
      const st = await fs.stat(abs);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      out.push({ path: rel, size: st.size, modified: st.mtimeMs, previewable: isText(rel) });
    }
  }
  return out;
}

export async function listFiles(convId: string): Promise<FileInfo[]> {
  const files = await walk(convDir(convId));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeContent(raw: string): string {
  let c = raw.replace(/^\r?\n/, '');
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(c.trim());
  if (fenced) c = fenced[1];
  return c.replace(/\s+$/, '') + '\n';
}

export async function writeGenerated(convId: string, rawPath: string, rawContent: string): Promise<FileInfo> {
  const root = convDir(convId);
  const { abs, rel } = safeResolve(root, rawPath);
  if (rel.split('/').length > 10) throw new HttpError(400, 'Path terlalu dalam');
  if (!isAllowedName(rel)) throw new HttpError(400, `Tipe file tidak diizinkan: ${rel}`);
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.zip') throw new HttpError(400, 'ZIP dibuat lewat blok exbotz-zip');

  const content = normalizeContent(rawContent);
  let data: Buffer;
  if (ext === '.pdf') data = await renderPdf(content);
  else if (ext === '.docx') data = await renderDocx(content);
  else data = Buffer.from(content, 'utf8');
  if (data.length > config.maxGeneratedFileBytes) throw new HttpError(413, `File terlalu besar: ${rel}`);

  const existing = await walk(root);
  const prev = existing.find((f) => f.path === rel);
  const total = existing.reduce((s, f) => s + f.size, 0) - (prev?.size ?? 0) + data.length;
  if (total > config.maxWorkspaceBytes) throw new HttpError(413, 'Kuota penyimpanan percakapan penuh');
  if (!prev && existing.length >= config.maxWorkspaceFiles) throw new HttpError(413, 'Jumlah file maksimum tercapai');

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
  return { path: rel, size: data.length, modified: Date.now(), previewable: isText(rel) };
}

/** Path absolut file yang sudah ada, dicek ulang via realpath (anti symlink/traversal). */
export async function resolveExisting(convId: string, rawPath: string): Promise<{ abs: string; rel: string }> {
  const root = convDir(convId);
  const { abs, rel } = safeResolve(root, rawPath);
  let real: string;
  let realRoot: string;
  try {
    real = await fs.realpath(abs);
    realRoot = await fs.realpath(root);
  } catch {
    throw new HttpError(404, 'File tidak ditemukan');
  }
  if (!real.startsWith(realRoot + path.sep)) throw new HttpError(400, 'Path file tidak valid');
  const st = await fs.stat(real);
  if (!st.isFile()) throw new HttpError(404, 'File tidak ditemukan');
  return { abs: real, rel };
}

export async function readPreview(convId: string, rawPath: string): Promise<{ path: string; content: string; truncated: boolean }> {
  const { abs, rel } = await resolveExisting(convId, rawPath);
  if (!isText(rel)) throw new HttpError(415, 'File ini tidak bisa dipratinjau sebagai teks');
  const max = 200_000;
  const fh = await fs.open(abs, 'r');
  try {
    const st = await fh.stat();
    const buf = Buffer.alloc(Math.min(st.size, max));
    await fh.read(buf, 0, buf.length, 0);
    return { path: rel, content: buf.toString('utf8'), truncated: st.size > max };
  } finally {
    await fh.close();
  }
}

/** Isi file teks workspace untuk konteks AI (agar bisa mengedit file yang sudah ada). */
export async function workspaceContext(convId: string, budget = 30000): Promise<string> {
  const files = (await listFiles(convId)).filter((f) => f.previewable && !f.path.endsWith('.svg'));
  if (!files.length) return '';
  let out = 'FILE YANG SUDAH ADA DI WORKSPACE:\n';
  for (const f of files) out += `- ${f.path} (${f.size} B)\n`;
  for (const f of files) {
    if (budget <= 0) break;
    try {
      const { content } = await readPreview(convId, f.path);
      const slice = content.slice(0, Math.min(12000, budget));
      budget -= slice.length;
      out += `\n=== ${f.path} ===\n${slice}\n`;
    } catch {
      /* lewati */
    }
  }
  return out;
}

export async function createZip(convId: string, dir: string | undefined, name: string | undefined): Promise<FileInfo> {
  const root = convDir(convId);
  let prefix = '';
  if (dir && dir !== '.' && dir !== '/') prefix = safeResolve(root, dir).rel.replace(/\/+$/, '');
  const files = (await walk(root)).filter(
    (f) => !f.path.toLowerCase().endsWith('.zip') && (prefix === '' || f.path === prefix || f.path.startsWith(prefix + '/')),
  );
  if (!files.length) throw new HttpError(400, 'Tidak ada file untuk dikemas');

  const fallback = (prefix ? path.posix.basename(prefix) : 'project') + '.zip';
  let zipName = path.posix.basename((name || fallback).replace(/\\/g, '/')).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!zipName.toLowerCase().endsWith('.zip')) zipName += '.zip';
  const { abs, rel } = safeResolve(root, zipName);
  const parent = prefix ? path.posix.dirname(prefix) : '';

  await new Promise<void>((resolve, reject) => {
    const out = fsSync.createWriteStream(abs);
    const ar = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    ar.on('error', reject);
    ar.pipe(out);
    for (const f of files) {
      const entry = parent && parent !== '.' ? path.posix.relative(parent, f.path) : f.path;
      ar.file(path.join(root, f.path), { name: entry });
    }
    ar.finalize().catch(reject);
  });
  const st = await fs.stat(abs);
  return { path: rel, size: st.size, modified: st.mtimeMs, previewable: false };
}

export async function deleteWorkspace(convId: string): Promise<void> {
  await fs.rm(convDir(convId), { recursive: true, force: true });
  await fs.rm(path.join(config.dataDir, 'attachments', convId), { recursive: true, force: true });
}
