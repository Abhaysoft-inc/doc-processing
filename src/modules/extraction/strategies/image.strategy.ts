import { ExtractorStrategy, StrategyExtractionResult } from './strategy.interface.js';
import { ValidatedFile } from '../../validation/file-validator.js';
import { extractWithVlm } from '../vlm-extractor.service.js';

/**
 * Handles image files (JPEG, PNG, WebP, GIF, TIFF) via Gemini VLM OCR.
 */
export const imageStrategy: ExtractorStrategy = {
  supportedMimes: new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
  ]),

  async extract(file: ValidatedFile): Promise<StrategyExtractionResult> {
    const ast = await extractWithVlm(file.buffer, file.detectedMimeType, file.originalName, 1);
    return {
      ast,
      routeTaken: 'vlm_ocr',
      pageCount: 1,
    };
  },
};
