import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../../config/index.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

export interface ValidatedFile {
  buffer: Buffer;
  originalName: string;
  detectedMimeType: string;
  detectedExtension: string;
  sizeBytes: number;
  sha256: string;
}

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/x-cfb', // CFBF container for legacy .doc
  'application/zip', // Some docx files may detect as generic zip initially
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

/**
 * Validates a file by inspecting magic bytes, computing SHA-256 hash, and checking size constraints.
 */
export async function validateUploadedFile(
  file: Express.Multer.File,
  clientSha256?: string
): Promise<ValidatedFile> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError('EMPTY_FILE', 'Upload rejected: Document buffer is empty or missing.', 400, true);
  }

  // 1. Size constraint check
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (file.buffer.length > maxBytes) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `File size (${(file.buffer.length / 1024 / 1024).toFixed(2)} MB) exceeds configured limit of ${config.maxFileSizeMb} MB.`,
      413,
      true
    );
  }

  // 2. Compute SHA-256 hash
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

  // Verify client-provided checksum if present
  if (clientSha256 && clientSha256.toLowerCase() !== sha256.toLowerCase()) {
    throw new AppError(
      'DATA_INTEGRITY_MISMATCH',
      `Data integrity violation: computed SHA-256 does not match expected checksum.`,
      400,
      true
    );
  }

  // 3. Inspect magic bytes using file-type and header signatures
  const detectedType = await fileTypeFromBuffer(file.buffer);

  let detectedMimeType = '';
  let detectedExtension = '';

  // Special handling for PDF magic bytes (%PDF-)
  const isPdfHeader =
    file.buffer.length >= 4 &&
    file.buffer[0] === 0x25 &&
    file.buffer[1] === 0x50 &&
    file.buffer[2] === 0x44 &&
    file.buffer[3] === 0x46;

  // Special handling for DOCX (standard OOXML is a PK Zip archive)
  const isZipHeader =
    file.buffer.length >= 4 &&
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b &&
    file.buffer[2] === 0x03 &&
    file.buffer[3] === 0x04;

  // Special handling for legacy DOC (Compound File Binary Format / CFBF: D0 CF 11 E0 A1 B1 1A E1)
  const isDocHeader =
    file.buffer.length >= 8 &&
    file.buffer[0] === 0xd0 &&
    file.buffer[1] === 0xcf &&
    file.buffer[2] === 0x11 &&
    file.buffer[3] === 0xe0 &&
    file.buffer[4] === 0xa1 &&
    file.buffer[5] === 0xb1 &&
    file.buffer[6] === 0x1a &&
    file.buffer[7] === 0xe1;

  const originalLower = file.originalname.toLowerCase();

  if (isPdfHeader) {
    detectedMimeType = 'application/pdf';
    detectedExtension = 'pdf';
  } else if (
    isZipHeader &&
    (originalLower.endsWith('.docx') || originalLower.endsWith('.doc'))
  ) {
    detectedMimeType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    detectedExtension = 'docx';
  } else if (
    isDocHeader ||
    (detectedType &&
      (detectedType.mime === 'application/x-cfb' ||
        detectedType.mime === 'application/msword' ||
        detectedType.ext === 'cfb') &&
      (originalLower.endsWith('.doc') || originalLower.endsWith('.dot')))
  ) {
    detectedMimeType = 'application/msword';
    detectedExtension = 'doc';
  } else if (detectedType && ALLOWED_MIME_TYPES.has(detectedType.mime)) {
    detectedMimeType = detectedType.mime;
    detectedExtension = detectedType.ext;
  } else {
    throw new AppError(
      'UNSUPPORTED_FILE_TYPE',
      'File validation failed: Magic byte signature is missing or unrecognized. Only authentic PDF, DOCX, DOC, and images (PNG, JPEG, WEBP, GIF, TIFF) are accepted.',
      415,
      true
    );
  }

  // Log MIME type and size only at DEBUG (no document contents or PII)
  log().debug(
    {
      mimeType: detectedMimeType,
      sizeBytes: file.buffer.length,
    },
    'File validation passed'
  );

  return {
    buffer: file.buffer,
    originalName: file.originalname,
    detectedMimeType,
    detectedExtension,
    sizeBytes: file.buffer.length,
    sha256,
  };
}
