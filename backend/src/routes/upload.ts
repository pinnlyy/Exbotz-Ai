import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { asyncHandler, HttpError } from '../errors';
import { isValidId } from '../files/safePath';
import { extractUpload } from '../services/extract';
import { saveAttachment } from '../services/attachments';

export const uploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
});

uploadRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const convId = String(req.body?.conversationId ?? '');
    if (!isValidId(convId)) throw new HttpError(400, 'ID percakapan tidak valid');
    if (!req.file) throw new HttpError(400, 'File tidak ditemukan');
    const extracted = await extractUpload(req.file.originalname, req.file.buffer);
    const id = await saveAttachment(convId, extracted);
    res.json({ id, name: extracted.name, kind: extracted.kind, size: req.file.size, note: extracted.note ?? null });
  }),
);
