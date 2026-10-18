import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { logger } from './logger.js';

export interface RequestStore {
  requestId: string;
  logger: Logger;
  startTime: bigint;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

/**
 * Returns the request-scoped child logger containing the current requestId,
 * or falls back to the base application logger if outside an active HTTP request.
 */
export function log(): Logger {
  const store = requestContext.getStore();
  return store ? store.logger : logger;
}

/**
 * Returns the active requestId if within a request context, or undefined.
 */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
