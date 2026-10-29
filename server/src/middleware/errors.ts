import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../db/pool.js';

/**
 * Convert an error into a consistent JSON envelope.
 *
 * Messages reachable by a user are always ones we wrote. An unexpected error is
 * logged in full server-side and replaced with a generic message, so a database
 * or library message never becomes the response body.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      console.error(`[${req.method} ${req.path}]`, err);
    }
    res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code ?? 'ERROR',
        details: err.details ?? undefined,
      },
    });
    return;
  }

  console.error(`[${req.method} ${req.path}] unhandled`, err);
  res.status(500).json({
    error: {
      message: 'Something went wrong on our side. Please try again.',
      code: 'INTERNAL',
    },
  });
}

/** 404 for unmatched API routes, so they return JSON rather than HTML. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `No API route matches ${req.method} ${req.path}`,
      code: 'NOT_FOUND',
    },
  });
}

/**
 * Wrap an async handler so a rejected promise reaches errorHandler.
 *
 * Express 4 does not catch async rejections on its own; without this an
 * unhandled rejection would hang the request until it timed out.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
