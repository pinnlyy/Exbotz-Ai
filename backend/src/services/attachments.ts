import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { HttpError } from '../errors';
import { isValidId } from '../files/safePath';
import type { Extracted } from './extract';

const ATT_RE = /^[a-f0-9]{24}$/;
export const isValidAttachmentId = (id: string): boolean => ATT_RE.test(id);

function dir(convId: string): string {
  if (!isValidId(convId)) throw new HttpError(400, 'ID percakapan tidak valid');
  return path.join(config.dataDir, 'attachments', convId);
}

export async function saveAttachment(convId: string, data: Extracted): Promise<string> {
  const id = crypto.randomBytes(12).toString('hex');
  const d = dir(convId);
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, `${id}.json`), JSON.stringify(data));
  return id;
}

export async function loadAttachment(convId: string, id: string): Promise<Extracted> {
  if (!isValidAttachmentId(id)) throw new HttpError(400, 'ID lampiran tidak valid');
  try {
    return JSON.parse(await fs.readFile(path.join(dir(convId), `${id}.json`), 'utf8')) as Extracted;
  } catch {
    throw new HttpError(404, 'Lampiran tidak ditemukan');
  }
}
