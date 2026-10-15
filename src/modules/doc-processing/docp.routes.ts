import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'node:path';
import { processDocumentController } from './docp.controllers.js';
import { config } from '../../config/index.js';

const router = Router();

// Allowed MIME types and extensions
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tiff',
  '.tif',
]);

// Memory storage keeps file buffers accessible for direct S3 upload & VLM parsing
const storage = multer.memoryStorage();

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isMimeAllowed = ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase());
  const isExtAllowed = ALLOWED_EXTENSIONS.has(ext);

  if (isMimeAllowed || isExtAllowed) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: "${file.originalname}". Only PDF, DOCX, and images (JPEG, PNG, WEBP, GIF, TIFF) are supported.`
      )
    );
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024, // e.g. 20MB
  },
  fileFilter,
});

/**
 * Middleware wrapper to catch Multer errors (file size limits, invalid formats) cleanly
 */
function uploadMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: `File size exceeds the limit of ${config.maxFileSizeMb}MB.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
    next();
  });
}

// POST /process - Upload and process document
router.post('/process', uploadMiddleware, processDocumentController);

export default router;