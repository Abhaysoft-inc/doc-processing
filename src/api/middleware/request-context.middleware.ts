import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { requestContext } from '../../shared/context.js';
import { logger } from '../../shared/logger.js';

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

    childLogger.info(
      {
        method: req.method,
        path: req.originalUrl || req.path,
        status: res.statusCode,
        durationMs,
      },
      `${req.method} ${req.originalUrl || req.path} ${res.statusCode} ${durationMs}ms`
    );
  });

  requestContext.run(store, () => {
    next();
  });
}
