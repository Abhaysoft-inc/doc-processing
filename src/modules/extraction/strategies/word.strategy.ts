import { ExtractorStrategy, StrategyExtractionResult } from './strategy.interface.js';
import { ValidatedFile } from '../../validation/file-validator.js';
import { extractFromDocx } from '../docx-extractor.service.js';
import { extractFromDoc } from '../doc-extractor.service.js';
import { AppError } from '../../../shared/errors.js';
import { log } from '../../../shared/context.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';

/**
 * Handles Word document extraction (modern DOCX and legacy DOC)
 * with automatic reciprocal fallback and clear 422 error propagation.
 */
export const wordStrategy: ExtractorStrategy = {
  supportedMimes: new Set([DOCX_MIME, DOC_MIME]),

  async extract(file: ValidatedFile): Promise<StrategyExtractionResult> {
    const isDocxPrimary = file.detectedMimeType.toLowerCase() === DOCX_MIME;

    if (isDocxPrimary) {
      try {
        const ast = await extractFromDocx(file.buffer, file.originalName);
        return { ast, routeTaken: 'digital_docx' };
      } catch (docxErr) {
        log().warn({ err: docxErr }, 'DOCX parser failed, attempting fallback to legacy DOC parser');
        try {
          const ast = await extractFromDoc(file.buffer, file.originalName);
          return { ast, routeTaken: 'digital_doc' };
        } catch (docErr) {
          log().warn(
            { primaryError: docxErr, fallbackError: docErr },
            'Both DOCX and legacy DOC parsers failed on document'
          );
          throw new AppError(
            'CORRUPT_DOCUMENT',
            'The Word document is corrupt or unreadable as either DOCX or DOC format.',
            422,
            true
          );
        }
      }
    } else {
      // Legacy DOC primary
      try {
        const ast = await extractFromDoc(file.buffer, file.originalName);
        return { ast, routeTaken: 'digital_doc' };
      } catch (docErr) {
        log().warn({ err: docErr }, 'Legacy DOC parser failed, attempting fallback to DOCX parser');
        try {
          const ast = await extractFromDocx(file.buffer, file.originalName);
          return { ast, routeTaken: 'digital_docx' };
        } catch (docxErr) {
          log().warn(
            { primaryError: docErr, fallbackError: docxErr },
            'Both legacy DOC and DOCX parsers failed on document'
          );
          throw new AppError(
            'CORRUPT_DOCUMENT',
            'The Word document is corrupt or unreadable as either DOC or DOCX format.',
            422,
            true
          );
        }
      }
    }
  },
};
