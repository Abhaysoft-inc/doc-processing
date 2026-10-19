import { Router } from 'express';
import {
  processDocumentController,
  getJobStatusController,
  generateDocxController,
  generatePdfController,
  generateAllAndUploadController,
  presignedUploadController,
} from './document.controller.js';

const router = Router();

// 1. Direct-to-S3 Upload: Generate presigned upload URL
router.post('/presigned-upload', presignedUploadController);

// 2. High-concurrency async queue-driven ingestion
router.post('/process', processDocumentController);
router.get('/jobs/:jobId', getJobStatusController);

// 3. Direct generation endpoints from Canonical AST
router.post('/generate/docx', generateDocxController);
router.post('/generate/pdf', generatePdfController);
router.post('/generate/all', generateAllAndUploadController);

export default router;
