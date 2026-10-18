import express from 'express';
import cors from 'cors';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/index.js';
import documentRouter from './api/document.routes.js';
import { openApiDocument } from './api/docs/openapi.js';
import { requestContextMiddleware } from './api/middleware/request-context.middleware.js';
import { errorHandlerMiddleware } from './api/middleware/error-handler.middleware.js';
import { logger } from './shared/logger.js';
import { startDocumentWorker, closeDocumentWorker } from './workers/document-processor.worker.js';
import { closeDocumentQueue } from './modules/queue/document-queue.js';


const app = express();

// request context middleware Must be registered FIRST in index.ts, otherwise code that runs before it has no request context.

app.use(requestContextMiddleware);

app.use(cors());

app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

app.use(express.static(path.resolve(process.cwd(), 'public')));

// Standard container liveness / readiness probe
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Detailed health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: config.env,
    isProduction: config.isProduction,
    timestamp: new Date().toISOString(),
  });
});

// Interactive API Documentation (Swagger UI) & raw OpenAPI spec
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.get('/api/docs.json', (req, res) => {
  res.json(openApiDocument);
});
app.get('/openapi.json', (req, res) => {
  res.json(openApiDocument);
});

// document processing routes
app.use('/api/documents', documentRouter);

app.use(errorHandlerMiddleware);

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      environment: config.env,
      logLevel: config.logLevel,
      docsUrl: `http://localhost:${config.port}/api/docs`,
    },
    `Server listening on port ${config.port} in ${config.env} mode. Swagger UI: http://localhost:${config.port}/api/docs`
  );

  // Start BullMQ background worker fleet
  startDocumentWorker();
});

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);

  // 20-second hard timeout
  const forceExitTimer = setTimeout(() => {
    logger.fatal({ signal }, 'Graceful shutdown timed out after 20s. Forcing exit.');
    process.exit(1);
  }, 20000);
  forceExitTimer.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('HTTP server closed.');

    await closeDocumentWorker();
    await closeDocumentQueue();
    logger.info('Queue and background worker fleet closed successfully.');

    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error occurred during graceful shutdown');
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}


process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal({ err, stack: err.stack }, 'Unhandled Promise Rejection detected');
});

process.on('uncaughtException', (err: Error) => {
  logger.fatal({ err, stack: err.stack }, 'Uncaught Exception detected. Terminating process.');
  process.exit(1);
});
