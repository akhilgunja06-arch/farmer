import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { HttpError } from '../db/pool.js';

/**
 * Validate and replace req.body with the parsed result.
 *
 * Zod strips unknown keys by default, so a client cannot smuggle extra fields
 * (a `role`, a `payment_status`, a `farmer_id`) past the schema and into an
 * INSERT. Anything the schema does not name simply does not survive.
 */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(toHttpError(result.error));
      return;
    }
    req.body = result.data as z.infer<T>;
    next();
  };
}

/** Validate query parameters. Values arrive as strings; schemas coerce. */
export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(toHttpError(result.error));
      return;
    }
    // Express 5 makes req.query a getter-only property on some versions, so
    // stash the parsed value rather than assigning over it.
    (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    next();
  };
}

export function getQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: unknown }).validatedQuery as T;
}

function toHttpError(error: ZodError): HttpError {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  const first = error.issues[0];
  return new HttpError(
    422,
    first?.message ?? 'Some of the submitted values were not valid.',
    'VALIDATION_FAILED',
    fieldErrors,
  );
}
