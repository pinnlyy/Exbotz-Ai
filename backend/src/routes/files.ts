import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../errors';
import {
  convDir, createZip, deleteWorkspace, listFiles, readPreview, resolveExisting,
} from '../files/fileStore';

export const filesRouter = Router();

const pathQuery = (v: unknown): string => {
  if (typeof v !== 'string' || !v) throw new HttpError(400, 'Parameter path wajib diisi');
  return v;
};

filesRouter.get(
  '/:convId',
  asyncHandler(async (req, res) => {
    res.json({ files: await listFiles(req.params.convId) });
  }),
);

filesRouter.get(
  '/:convId/preview',
  asyncHandler(async (req, res) => {
    res.json(await readPreview(req.params.convId, pathQuery(req.query.path)));
  }),
);

filesRouter.get(
  '/:convId/download',
  asyncHandler(async (req, res) => {
    const { abs, rel } = await resolveExisting(req.params.convId, pathQuery(req.query.path));
    res.set('X-Content-Type-Options', 'nosniff');
    await new Promise<void>((resolve, reject) => {
      res.download(abs, rel.split('/').pop() ?? 'file', (err) => (err ? reject(err) : resolve()));
    });
  }),
);

const zipBody = z.object({ dir: z.string().max(200).optional(), name: z.string().max(100).optional() });

filesRouter.post(
  '/:convId/zip',
  asyncHandler(async (req, res) => {
    const body = zipBody.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, 'Request tidak valid');
    convDir(req.params.convId);
    res.json({ file: await createZip(req.params.convId, body.data.dir, body.data.name) });
  }),
);

filesRouter.delete(
  '/:convId',
  asyncHandler(async (req, res) => {
    await deleteWorkspace(req.params.convId);
    res.json({ ok: true });
  }),
);
