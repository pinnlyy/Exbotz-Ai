import { Router } from 'express';
import { config } from '../config';
import { asyncHandler, HttpError, UpstreamError } from '../errors';
import { listModels } from '../providers/ninerouter';

export const modelsRouter = Router();

modelsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    try {
      const models = await listModels();
      models.sort((a, b) => Number(b.isCombo) - Number(a.isCombo) || a.id.localeCompare(b.id));
      res.json({ models, defaultModel: config.defaultModel });
    } catch (e) {
      if (e instanceof UpstreamError) throw new HttpError(502, `9Router mengembalikan error ${e.status}: ${e.detail}`);
      throw new HttpError(502, 'Tidak dapat terhubung ke 9Router');
    }
  }),
);
