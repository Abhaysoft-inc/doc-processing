import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  processDocumentController,
  generateDocxController,
  generatePdfController,
  generateAllAndUploadController,
  presignedUploadController,
  processDocumentAsyncController,
  getJobStatusController,
} from './document.controller.js';

import { config } from '../config/index.js';

import os from 'node:os';
import crypto from 'node:crypto';

const router = Router();

// Disk storage streams incoming files directly to ephemeral temp directory, preventing OOM under high concurrency
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `doc-${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});

function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      return next(err);
    }
    next();
  });
}

// 1. Ingest, validate magic bytes, triage & extract to Canonical AST (synchronous)
router.post('/process', uploadMiddleware, processDocumentController);

// 2. High-concurrency async queue-driven ingestion
router.post('/process-async', processDocumentAsyncController);
router.get('/jobs/:jobId', getJobStatusController);

// 3. Direct generation endpoints from Canonical AST
router.post('/generate/docx', generateDocxController);
router.post('/generate/pdf', generatePdfController);
router.post('/generate/all', generateAllAndUploadController);

// 4. Storage utility: Presigned direct upload
router.post('/presigned-upload', presignedUploadController);

export default router;

