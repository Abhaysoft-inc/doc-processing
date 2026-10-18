import crypto from 'node:crypto';
import { ValidatedFile } from '../validation/file-validator.js';
import { CanonicalDocument } from '../canonical/canonical.types.js';
import { ExtractorStrategy, ExtractionRoute } from './strategies/strategy.interface.js';
import { pdfStrategy } from './strategies/pdf.strategy.js';
import { wordStrategy } from './strategies/word.strategy.js';
import { imageStrategy } from './strategies/image.strategy.js';
import { log } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import { startTimer } from '../../shared/timer.js';

export interface ExtractionTriageResult {
  ast: CanonicalDocument;
  routeTaken: ExtractionRoute;
  pageCount?: number;
}

const STRATEGIES: ExtractorStrategy[] = [
  pdfStrategy,
  wordStrategy,
  imageStrategy,
];

/**
 * Intelligent document triage orchestrator:
 * 1. Matches the file to an extraction strategy by magic-byte MIME type
 * 2. Executes format-specific extraction
 * 3. Stamps document ID & SHA-256 integrity metadata ONCE
 * 4. Logs a single unified completion/failure summary
 */
export async function triageAndExtract(
  file: ValidatedFile,
  existingDocId?: string
): Promise<ExtractionTriageResult> {
  const stopTimer = startTimer();
  const documentId = existingDocId || crypto.randomUUID();
  let route: ExtractionRoute = 'vlm_ocr';
  let pageCount: number | undefined = undefined;

  try {
    const mime = file.detectedMimeType.toLowerCase();
    const strategy = STRATEGIES.find((s) => s.supportedMimes.has(mime));

    if (!strategy) {
      throw new AppError(
        'UNSUPPORTED_FILE_TYPE',
        `Unsupported media type for document extraction: ${file.detectedMimeType}`,
        415,
        true
      );
    }

    const result = await strategy.extract(file);
    route = result.routeTaken;
    pageCount = result.pageCount;

    // Stamp identity and integrity metadata ONCE
    result.ast.id = documentId;
    result.ast.metadata.originalFileSha256 = file.sha256;

    const totalDurationMs = stopTimer();
    log().info(
      {
        documentId,
        route,
        totalDurationMs,
        ...(pageCount !== undefined && { pages: pageCount }),
        outcome: 'success',
      },
      'Document extraction completed'
    );

    return result;
  } catch (err: unknown) {
    const totalDurationMs = stopTimer();
    log().info(
      {
        documentId,
        route,
        totalDurationMs,
        ...(pageCount !== undefined && { pages: pageCount }),
        outcome: 'failed',
      },
      'Document extraction failed'
    );

    if (err instanceof AppError) {
      throw err;
    }

    log().error({ err, route, documentId }, 'Unexpected library error during document extraction');
    throw new AppError(
      'EXTRACTION_FAILED',
      `Document extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
      false
    );
  }
}
