import type { NextFunction, Request, Response, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class UpstreamError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Upstream ${status}`);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };
