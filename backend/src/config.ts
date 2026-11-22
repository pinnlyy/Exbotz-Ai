import 'dotenv/config';
import path from 'node:path';

function num(name: string, def: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Nilai ${name} tidak valid`);
  return n;
}

const appToken = process.env.APP_TOKEN ?? '';
if (appToken.length < 24 || appToken.startsWith('GANTI_')) {
  throw new Error('APP_TOKEN wajib diisi (min 24 karakter). Lihat .env.example');
}

const MB = 1024 * 1024;

export const config = {
  port: num('PORT', 8787),
  appToken,
  nineRouterBaseUrl: (process.env.NINEROUTER_BASE_URL || 'http://localhost:20128/v1').replace(/\/+$/, ''),
  nineRouterApiKey: process.env.NINEROUTER_API_KEY || '',
  defaultModel: process.env.NINEROUTER_DEFAULT_MODEL || '',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  maxUploadBytes: num('MAX_UPLOAD_MB', 15) * MB,
  maxGeneratedFileBytes: num('MAX_GENERATED_FILE_MB', 5) * MB,
  maxWorkspaceBytes: num('MAX_WORKSPACE_MB', 50) * MB,
  maxWorkspaceFiles: num('MAX_WORKSPACE_FILES', 300),
  maxZipUncompressedBytes: num('MAX_ZIP_UNCOMPRESSED_MB', 60) * MB,
  maxAttachmentChars: num('MAX_ATTACHMENT_CHARS', 60000),
  maxContextChars: num('MAX_CONTEXT_CHARS', 200000),
};
