import { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  uploadBufferToS3,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
} from '../modules/storage/s3.service.js';
import { validateCanonicalDocument } from '../modules/canonical/canonical.schema.js';
import { generateDocxBuffer } from '../modules/generation/docx-generator.js';
import { generatePdfBuffer } from '../modules/generation/pdf-generator.js';
import { AppError, wrap } from '../shared/errors.js';
import { log } from '../shared/context.js';
import {
  enqueueDocumentJob,
  getDocumentJobStatus,
} from '../modules/queue/document-queue.js';

/**
 * Accepts document metadata and S3 location, enqueueing a background processing job.
 * Returns 202 Accepted with a jobId immediately (< 15ms).
 */
export const processDocumentController = wrap(async (req: Request, res: Response): Promise<void> => {
  const { s3Key, originalName, mimeType, tenantId, userId } = req.body;

  if (!s3Key || !originalName || !mimeType) {
    throw new AppError(
      'MISSING_PARAMETER',
      'Missing required fields: "s3Key", "originalName", and "mimeType" are required.',
      400,
      true
    );
  }

  const { jobId } = await enqueueDocumentJob({
    s3Key,
    originalName,
    mimeType,
    tenantId: tenantId || 'default',
    userId,
  });

  res.status(202).json({
    success: true,
    jobId,
    status: 'queued',
    message: 'Document job accepted and enqueued for background processing.',
    data: {
      jobId,
      status: 'queued',
      statusUrl: `/api/documents/jobs/${jobId}`,
    },
  });
});


/**
 * Generates and downloads a native DOCX file from a Canonical Document AST.
 */
export const generateDocxController = wrap(async (req: Request, res: Response): Promise<void> => {
  const rawAst = req.body.ast || req.body;
  if (!rawAst) {
    throw new AppError('INVALID_AST', 'Missing document AST in request body.', 400, true);
  }

  const ast = validateCanonicalDocument(rawAst);
  const docxBuffer = await generateDocxBuffer(ast);
  const filename = `${(ast.title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;

  log().debug(
    {
      docId: ast.id,
      format: 'docx',
      sizeBytes: docxBuffer.length,
    },
    'DOCX document generated for download'
  );

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', docxBuffer.length);
  res.end(docxBuffer);
});

/**
 * Generates and downloads a pixel-perfect PDF file from a Canonical Document AST.
 */
export const generatePdfController = wrap(async (req: Request, res: Response): Promise<void> => {
  const rawAst = req.body.ast || req.body;
  if (!rawAst) {
    throw new AppError('INVALID_AST', 'Missing document AST in request body.', 400, true);
  }

  const ast = validateCanonicalDocument(rawAst);
  const pdfBuffer = await generatePdfBuffer(ast);
  const filename = `${(ast.title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  log().debug(
    {
      docId: ast.id,
      format: 'pdf',
      sizeBytes: pdfBuffer.length,
    },
    'PDF document generated for download'
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.end(pdfBuffer);
});

/**
 * Generates both DOCX and PDF, uploads them to S3, and returns presigned download URLs.
 */
export const generateAllAndUploadController = wrap(async (req: Request, res: Response): Promise<void> => {
  const rawAst = req.body.ast || req.body;
  if (!rawAst) {
    throw new AppError('INVALID_AST', 'Missing document AST in request body.', 400, true);
  }

  const ast = validateCanonicalDocument(rawAst);
  const docId = req.body.docId || ast.id || crypto.randomUUID();
  const tenantId = req.body.tenantId || 'default';
  const baseName = (ast.title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Generate both formats concurrently
  const [docxBuffer, pdfBuffer] = await Promise.all([
    generateDocxBuffer(ast),
    generatePdfBuffer(ast),
  ]);

  // Upload both to S3 concurrently
  const [docxUpload, pdfUpload] = await Promise.all([
    uploadBufferToS3(docxBuffer, `${baseName}.docx`, {
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      tenantId,
      docId,
    }),
    uploadBufferToS3(pdfBuffer, `${baseName}.pdf`, {
      contentType: 'application/pdf',
      tenantId,
      docId,
    }),
  ]);

  // Generate presigned download links
  const [docxDownloadUrl, pdfDownloadUrl] = await Promise.all([
    createPresignedDownloadUrl(docxUpload.key),
    createPresignedDownloadUrl(pdfUpload.key),
  ]);

  log().debug(
    {
      docId,
      tenantId,
      docxKey: docxUpload.key,
      pdfKey: pdfUpload.key,
    },
    'Generated and stored both DOCX and PDF'
  );

  res.status(200).json({
    success: true,
    message: 'Both DOCX and PDF documents generated and stored successfully.',
    data: {
      docId,
      title: ast.title,
      docx: {
        s3Location: docxUpload.s3Url,
        downloadUrl: docxDownloadUrl,
        sizeBytes: docxBuffer.length,
      },
      pdf: {
        s3Location: pdfUpload.s3Url,
        downloadUrl: pdfDownloadUrl,
        sizeBytes: pdfBuffer.length,
      },
    },
  });
});

/**
 * Generates a presigned S3 upload URL allowing direct browser-to-S3 uploads.
 */
export const presignedUploadController = wrap(async (req: Request, res: Response): Promise<void> => {
  const { filename, contentType, tenantId, docId } = req.body;
  if (!filename || !contentType) {
    throw new AppError(
      'MISSING_PARAMETER',
      'Missing required parameters "filename" and "contentType".',
      400,
      true
    );
  }

  const presigned = await createPresignedUploadUrl(
    filename,
    contentType,
    900, // 15 mins
    tenantId || 'default',
    docId || crypto.randomUUID()
  );

  log().debug(
    {
      key: presigned.key,
      tenantId: tenantId || 'default',
    },
    'Generated presigned upload URL'
  );

  res.status(200).json({
    success: true,
    data: presigned,
  });
});


/**
 * Retrieves the live status, progress, and result of a background document processing job.
 */
export const getJobStatusController = wrap(async (req: Request, res: Response): Promise<void> => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    throw new AppError('MISSING_PARAMETER', 'Path parameter "jobId" is required.', 400, true);
  }

  const jobStatus = await getDocumentJobStatus(jobId);


  if (!jobStatus) {
    throw new AppError('JOB_NOT_FOUND', `Document job with ID "${jobId}" was not found.`, 404, true);
  }

  res.status(200).json({
    success: true,
    data: jobStatus,
  });
});

