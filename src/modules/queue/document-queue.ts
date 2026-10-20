import { Queue } from 'bullmq';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { log } from '../../shared/context.js';

export interface DocumentJobPayload {
  s3Key: string;
  originalName: string;
  mimeType: string;
  tenantId?: string;
  userId?: string;
}

export interface DocumentJobResult {
  jobId: string;
  documentId: string;
  status: 'completed' | 'failed';
  s3AstKey?: string;
  s3AstUrl?: string;
  s3MarkdownKey?: string;
  s3MarkdownUrl?: string;
  markdownText?: string;
  pageCount?: number;
  durationMs?: number;
  error?: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: string;
  progress: number;
  result?: DocumentJobResult;
  error?: string;
  failedReason?: string;
  createdAt?: number;
  processedOn?: number;
  finishedOn?: number;
}

export const DOCUMENT_QUEUE_NAME = 'document-processing';

import { redisConnection } from '../../config/redis.js';
export { redisConnection };



export const documentQueue = new Queue<DocumentJobPayload, DocumentJobResult>(
  DOCUMENT_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 86400, // keep completed jobs for 24 hours
        count: 5000,
      },
      removeOnFail: {
        age: 86400 * 7, // keep failed jobs for 7 days
      },
    },
  }
);

/**
 * Enqueues a document processing task into BullMQ.
 */
export async function enqueueDocumentJob(
  payload: DocumentJobPayload,
  customJobId?: string
): Promise<{ jobId: string }> {
  const jobId = customJobId || crypto.randomUUID();
  await documentQueue.add('process-document', payload, {
    jobId,
  });

  log().info(
    { jobId, s3Key: payload.s3Key, mimeType: payload.mimeType, tenantId: payload.tenantId },
    'Enqueued document processing job'
  );

  return { jobId };
}

/**
 * Fetches the current state, progress, and results of a BullMQ job.
 */
export async function getDocumentJobStatus(jobId: string): Promise<JobStatusResponse | null> {
  const job = await documentQueue.getJob(jobId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  return {
    jobId: String(job.id),
    status: state,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    result: job.returnvalue || undefined,
    error: job.failedReason || undefined,
    failedReason: job.failedReason || undefined,
    createdAt: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}

/**
 * Closes the document queue gracefully.
 */
export async function closeDocumentQueue(): Promise<void> {
  await documentQueue.close();
}
