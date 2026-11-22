import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { requireAuth } from './auth';
import { HttpError } from './errors';
import { chatRouter } from './routes/chat';
import { filesRouter } from './routes/files';
import { modelsRouter } from './routes/models';
import { uploadRouter } from './routes/upload';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS: hanya origin yang terdaftar di CORS_ORIGIN (mis. https://username.github.io)
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const o = req.header('origin');
  if (o && origins.includes(o)) {
    res.set({
      'Access-Control-Allow-Origin': o,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
  }
  next();
});
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }),
  requireAuth,
);
app.get('/api/ping', (_req, res) => res.json({ ok: true, version: '1.0.0', defaultModel: config.defaultModel }));
app.use('/api/models', modelsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/files', filesRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File melebihi batas ukuran upload' });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request terlalu besar' });
  } else if (err?.code === 'ENOENT') {
    res.status(404).json({ error: 'File tidak ditemukan' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

async function main() {
  await fs.mkdir(path.join(config.dataDir, 'workspaces'), { recursive: true });
  await fs.mkdir(path.join(config.dataDir, 'attachments'), { recursive: true });
  app.listen(config.port, () => {
    console.log(`ExBotz backend berjalan di port ${config.port}`);
    console.log(`9Router: ${config.nineRouterBaseUrl}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
