import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { requestContext } from '../../shared/context.js';
import { logger } from '../../shared/logger.js';
import { getElapsedMs } from '../../shared/timer.js';


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
    // Strip query string to ensure sensitive values (tokens, secrets, signed URLs) never leak into logs
    const sanitizedPath = (req.originalUrl ? req.originalUrl.split('?')[0] : req.path) || '/';

    // Skip the "request completed" log for /healthz
    if (sanitizedPath === '/healthz') {
      return;
    }

    const durationMs = getElapsedMs(startHr);
    const status = res.statusCode;

    const payload = {
      method: req.method,
      path: sanitizedPath,
      status,
      durationMs,
    };
    const message = `${req.method} ${sanitizedPath} ${status} ${durationMs}ms`;

    if (status >= 500) {
      childLogger.error(payload, message);
    } else if (status >= 400) {
      childLogger.warn(payload, message);
    } else {
      childLogger.info(payload, message);
    }
  });

  requestContext.run(store, () => {
    next();
  });
}
