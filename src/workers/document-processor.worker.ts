import { Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../shared/logger.js';
import { requestContext, log } from '../shared/context.js';
import { startTimer } from '../shared/timer.js';
import { downloadBufferFromS3, uploadBufferToS3 } from '../modules/storage/s3.service.js';
import { validateBuffer } from '../modules/validation/file-validator.js';
import { triageAndExtract } from '../modules/extraction/triage.service.js';
import { redisConnection } from '../config/redis.js';
import {
  DOCUMENT_QUEUE_NAME,
  DocumentJobPayload,
  DocumentJobResult,
} from '../modules/queue/document-queue.js';
import { renderCanonicalToMarkdown } from '../modules/generation/markdown-renderer.js';


let workerInstance: Worker<DocumentJobPayload, DocumentJobResult> | null = null;

/**
 * Initializes and starts the BullMQ background worker for document processing.
 */
export function startDocumentWorker(): Worker<DocumentJobPayload, DocumentJobResult> {
  if (workerInstance) {
    return workerInstance;
  }

  workerInstance = new Worker<DocumentJobPayload, DocumentJobResult>(
    DOCUMENT_QUEUE_NAME,
    async (job: Job<DocumentJobPayload, DocumentJobResult>) => {
      const jobRequestId = `job-${job.id}`;

      return requestContext.run(
        {
          requestId: jobRequestId,
          logger: logger.child({ requestId: jobRequestId, jobId: job.id }),
          startTime: process.hrtime.bigint(),
        },
        async () => {
          const stopTimer = startTimer();
          log().info(
            {
              jobId: job.id,
              s3Key: job.data.s3Key,
              originalName: job.data.originalName,
              tenantId: job.data.tenantId,
            },
            'Background worker picked up document job'
          );

          try {
            // Step 1: Download binary from S3
            await job.updateProgress(15);
            log().debug({ s3Key: job.data.s3Key }, 'Downloading file buffer from S3');
            const fileBuffer = await downloadBufferFromS3(job.data.s3Key);

            // Step 2: Validate magic bytes, integrity, and constraints
            await job.updateProgress(35);
            const validatedFile = await validateBuffer(fileBuffer, job.data.originalName);
            log().debug(
              {
                mime: validatedFile.detectedMimeType,
                sizeBytes: validatedFile.sizeBytes,
              },
              'File buffer validated successfully'
            );

            // Step 3: Triage and extract Canonical AST
            await job.updateProgress(60);
            const triageResult = await triageAndExtract(validatedFile, String(job.id));

            // Step 4: Serialize Canonical AST and render clean Markdown
            await job.updateProgress(80);
            const astJson = JSON.stringify(triageResult.ast, null, 2);
            const astBuffer = Buffer.from(astJson, 'utf-8');
            const markdownText = renderCanonicalToMarkdown(triageResult.ast);
            const markdownBuffer = Buffer.from(markdownText, 'utf-8');

            const tenantPrefix = job.data.tenantId ? `orgs/${job.data.tenantId}/` : '';
            const astKey = `uploads/${tenantPrefix}docs/${triageResult.ast.id}/canonical_ast.json`;
            const markdownKey = `uploads/${tenantPrefix}docs/${triageResult.ast.id}/document.md`;

            // Upload both Canonical AST and Markdown to S3 concurrently
            const [astUpload, markdownUpload] = await Promise.all([
              uploadBufferToS3(astBuffer, 'canonical_ast.json', {
                key: astKey,
                contentType: 'application/json',
                tenantId: job.data.tenantId,
                docId: triageResult.ast.id,
              }),
              uploadBufferToS3(markdownBuffer, 'document.md', {
                key: markdownKey,
                contentType: 'text/markdown; charset=utf-8',
                tenantId: job.data.tenantId,
                docId: triageResult.ast.id,
              }),
            ]);

            await job.updateProgress(100);

            const durationMs = stopTimer();
            const result: DocumentJobResult = {
              jobId: String(job.id),
              documentId: triageResult.ast.id,
              status: 'completed',
              s3AstKey: astUpload.key,
              s3AstUrl: astUpload.s3Url,
              s3MarkdownKey: markdownUpload.key,
              s3MarkdownUrl: markdownUpload.s3Url,
              markdownText,
              pageCount: triageResult.pageCount,
              durationMs,
            };

            log().info(
              {
                jobId: job.id,
                documentId: result.documentId,
                routeTaken: triageResult.routeTaken,
                pageCount: triageResult.pageCount,
                durationMs,
                s3AstKey: astUpload.key,
                s3MarkdownKey: markdownUpload.key,
                markdownChars: markdownText.length,
              },
              'Document job successfully processed and stored with AST and Markdown'
            );

            return result;
          } catch (err: unknown) {
            const durationMs = stopTimer();
            log().error(
              {
                jobId: job.id,
                durationMs,
                err,
              },
              'Document processing job failed during execution'
            );
            throw err;
          }
        }
      );
    },
    {
      connection: redisConnection,
      concurrency: config.queue.concurrency,
    }
  );

  workerInstance.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'BullMQ job completed event emitted');
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, attemptsMade: job?.attemptsMade, err: err?.message },
      'BullMQ job failed event emitted'
    );
  });

  workerInstance.on('error', (err) => {
    logger.error({ err: err?.message }, 'BullMQ worker encountered internal error');
  });

  logger.info(
    { queue: DOCUMENT_QUEUE_NAME, concurrency: config.queue.concurrency },
    'Document processor worker started'
  );

  return workerInstance;
}

/**
 * Gracefully shuts down the background worker.
 */
export async function closeDocumentWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    logger.info('Document processor worker closed');
  }
}
