import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  base: {
    service: 'doc-processor',
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.apiKey',
      '*.accessKeyId',
      '*.secretAccessKey',
      'apiKey',
      'accessKeyId',
      'secretAccessKey',
      'GEMINI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
    ],
    censor: '[REDACTED]',
  },
  transport: config.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
