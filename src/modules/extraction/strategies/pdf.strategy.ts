import { ExtractorStrategy, StrategyExtractionResult } from './strategy.interface.js';
import { ValidatedFile } from '../../validation/file-validator.js';
import { extractFromDigitalPdf } from '../digital-pdf.service.js';
import { extractWithVlm } from '../vlm-extractor.service.js';
import { log } from '../../../shared/context.js';

/**
 * Handles PDF extraction:
 * 1. Inspects per-page text density and image operators
 * 2. If pure digital, parses deterministically into AST
 * 3. If hybrid or scanned, delegates entire multi-page PDF to Gemini VLM OCR
 */
export const pdfStrategy: ExtractorStrategy = {
  supportedMimes: new Set(['application/pdf']),

  async extract(file: ValidatedFile): Promise<StrategyExtractionResult> {
    const digitalResult = await extractFromDigitalPdf(file.buffer, file.originalName);

    if (digitalResult.isDigital && digitalResult.ast) {
      return {
        ast: digitalResult.ast,
        routeTaken: 'digital_pdf',
        pageCount: digitalResult.pageCount,
      };
    }

    log().info(
      {
        originalName: file.originalName,
        pages: digitalResult.pageCount,
        totalChars: digitalResult.totalCharacters,
        reason: digitalResult.nonDigitalReason,
      },
      'PDF contains scanned/hybrid pages or insufficient digital text, routing to VLM OCR'
    );

    const ast = await extractWithVlm(
      file.buffer,
      file.detectedMimeType,
      file.originalName,
      digitalResult.pageCount
    );

    return {
      ast,
      routeTaken: 'vlm_ocr',
      pageCount: digitalResult.pageCount,
    };
  },
};
