import { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  uploadToS3,
  extractWithVLM,
  logDocumentResult,
  ProcessedDocumentResult,
} from './docp.services.js';

export async function processDocumentController(req: Request, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    res.status(400).json({
      success: false,
      error: 'No file uploaded. Please upload a file under the form-data key "file".',
    });
    return;
  }

  const jobId = crypto.randomUUID();
  console.log(`[Job] Created document processing job: ${jobId} for file "${file.originalname}"`);

  try {
    // 1. Upload to S3
    const s3Location = await uploadToS3(file, jobId);

    // 2. Extract information using Google Gemini Studio VLM
    const extractedInfo = await extractWithVLM(file);

    // 3. Prepare result data
    const result: ProcessedDocumentResult = {
      jobId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      s3Location,
      extractedInfo,
      extractedAt: new Date().toISOString(),
    };

    // 4. Log extraction results
    logDocumentResult(result);

    res.status(200).json({
      success: true,
      jobId,
      status: 'completed',
      message: 'Document successfully processed.',
      data: result,
    });
  } catch (error) {
    console.error(`[Job ${jobId}] Processing failed:`, error);
    res.status(500).json({
      success: false,
      jobId,
      status: 'failed',
      error: (error as Error).message || 'An unexpected error occurred during document processing.',
    });
  }
}
