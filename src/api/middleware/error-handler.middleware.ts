import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../shared/errors.js';
import { log, getRequestId } from '../../shared/context.js';
import { config } from '../../config/index.js';

export const errorHandlerMiddleware: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const logger = log();
  const requestId = getRequestId() || (res.getHeader('x-request-id') as string) || 'unknown';

  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      appError = new AppError(
        'FILE_TOO_LARGE',
        `File size exceeds configured limit of ${config.maxFileSizeMb}MB.`,
        413,
        true
      );
    } else {
      appError = new AppError('INVALID_UPLOAD', `File upload error: ${err.message}`, 400, true);
    }
  } else if (err instanceof Error) {
    appError = new AppError('INTERNAL_ERROR', err.message, 500, false);
  } else {
    appError = new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', 500, false);
  }

  if (appError.expected) {
    logger.warn(
      {
        code: appError.code,
        status: appError.status,
        message: appError.message,
      },
      appError.message
    );
  } else {
    const errorObject = err instanceof Error ? err : undefined;
    logger.error(
      {
        err: errorObject,
        code: appError.code,
        status: appError.status,
        stack: errorObject?.stack,
      },
      errorObject?.message || 'Unexpected internal error'
    );
  }

  const clientMessage =
    appError.expected || config.isDevelopment
      ? appError.message
      : 'An unexpected internal error occurred.';

  const errorResponse: {
    code: string;
    message: string;
    requestId: string;
    stack?: string;
  } = {
    code: appError.code,
    message: clientMessage,
    requestId,
  };

  if (config.isDevelopment && !appError.expected && err instanceof Error && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.status(appError.status).json({
    error: errorResponse,
  });
};
