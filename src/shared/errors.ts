import { Request, Response, NextFunction, RequestHandler } from 'express';

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly expected: boolean;

  constructor(code: string, message: string, status: number = 500, expected: boolean = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.expected = expected;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async controller wrapper ensuring any uncaught promise rejection passes cleanly to next().
 */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
