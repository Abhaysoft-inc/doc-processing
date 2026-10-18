import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { requestContext } from '../../shared/context.js';
import { logger } from '../../shared/logger.js';


/**
 * Assigns a request ID and stores a request-scoped logger in AsyncLocalStorage.
 *
 * Why: uploads are processed concurrently, so their log lines interleave.
 * Tagging every line with a requestId lets us trace one document end to end
 * (controller -> extraction -> S3) without passing a logger through every
 * function. The same ID is returned in the x-request-id response header so
 * support can look up a failed request.
 *
 * Must be registered FIRST in index.ts, otherwise code that runs before it
 * has no request context.
 */

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim()
      ? incomingId.trim()
      : crypto.randomUUID();

  res.setHeader('x-request-id', requestId);

  const childLogger = logger.child({ requestId });
  const startHr = process.hrtime.bigint();

  const store = {
    requestId,
    logger: childLogger,
    startTime: startHr,
  };

  res.on('finish', () => {
    const endHr = process.hrtime.bigint();
    const durationMs = Math.round(Number(endHr - startHr) / 10_000) / 100;

    // Strip query string to ensure sensitive values (tokens, secrets, signed URLs) never leak into logs
    const sanitizedPath = (req.originalUrl ? req.originalUrl.split('?')[0] : req.path) || '/';

    childLogger.info(
      {
        method: req.method,
        path: sanitizedPath,
        status: res.statusCode,
        durationMs,
      },
      `${req.method} ${sanitizedPath} ${res.statusCode} ${durationMs}ms`
    );
  });

  requestContext.run(store, () => {
    next();
  });
}
