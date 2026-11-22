import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

const expected = crypto.createHash('sha256').update(config.appToken).digest();

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const m = /^Bearer (.+)$/.exec(req.header('authorization') || '');
  const got = crypto.createHash('sha256').update(m ? m[1] : '').digest();
  if (!m || !crypto.timingSafeEqual(got, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
