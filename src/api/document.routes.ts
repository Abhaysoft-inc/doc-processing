import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  processDocumentController,
  generateDocxController,
  generatePdfController,
  generateAllAndUploadController,
  presignedUploadController,
} from './document.controller.js';
import { config } from '../config/index.js';

const router = Router();

// Memory storage keeps file buffers accessible for direct magic byte check, S3 upload & parsing
const storage = multer.memoryStorage();

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

// 1. Ingest, validate magic bytes, triage & extract to Canonical AST
router.post('/process', uploadMiddleware, processDocumentController);

// 2. Direct generation endpoints from Canonical AST
router.post('/generate/docx', generateDocxController);
router.post('/generate/pdf', generatePdfController);
router.post('/generate/all', generateAllAndUploadController);

// 3. Storage utility: Presigned direct upload
router.post('/presigned-upload', presignedUploadController);

export default router;
