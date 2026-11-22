import path from 'node:path';
import { HttpError } from '../errors';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isValidId = (id: string): boolean => ID_RE.test(id);

/** Resolusi path relatif di dalam root; menolak traversal, path absolut, dan karakter berbahaya. */
export function safeResolve(root: string, rel: string): { abs: string; rel: string } {
  if (typeof rel !== 'string' || !rel || rel.length > 200 || rel.includes('\0')) {
    throw new HttpError(400, 'Path file tidak valid');
  }
  const normalized = path.posix.normalize(rel.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new HttpError(400, 'Path file tidak valid');
  }
  const abs = path.resolve(root, normalized);
  if (!abs.startsWith(root + path.sep)) throw new HttpError(400, 'Path file tidak valid');
  return { abs, rel: normalized };
}
