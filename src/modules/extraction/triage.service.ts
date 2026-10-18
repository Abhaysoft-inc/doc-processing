import { ValidatedFile } from '../validation/file-validator.js';
import { CanonicalDocument } from '../canonical/canonical.types.js';
import { extractFromDigitalPdf } from './digital-pdf.service.js';
import { extractFromDocx } from './docx-extractor.service.js';
import { extractFromDoc } from './doc-extractor.service.js';
import { extractWithVlm } from './vlm-extractor.service.js';
import { log } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';

export interface ExtractionTriageResult {
  ast: CanonicalDocument;
  routeTaken: 'digital_docx' | 'digital_doc' | 'digital_pdf' | 'vlm_ocr';
  pageCount?: number;
}

/**
 * Intelligent dual-route document triage:
 * 1. DOCX / DOC -> Native Mammoth XML or WordExtractor parsing
 * 2. PDF (digital with selectable text) -> pdfjs-dist deterministic parsing
 * 3. PDF (scanned/raster) or Images -> Gemini VLM extraction
 *
 * Outputs ONE INFO summary line per document at the end and wraps library errors
 * once at this top-level entrypoint as EXTRACTION_FAILED.
 */
export async function triageAndExtract(file: ValidatedFile): Promise<ExtractionTriageResult> {
  const startHr = process.hrtime.bigint();
  const mime = file.detectedMimeType.toLowerCase();
  const name = file.originalName.toLowerCase();
  const ext = file.detectedExtension.toLowerCase();

  let route: 'digital_docx' | 'digital_doc' | 'digital_pdf' | 'vlm_ocr' = 'vlm_ocr';
  let documentId = 'unknown';
  let pageCount = 1;

  try {
    let result: ExtractionTriageResult;

    // Route 1a: Legacy Word DOC files
    if (
      ext === 'doc' ||
      mime === 'application/msword' ||
      (name.endsWith('.doc') && ext !== 'docx')
    ) {
      route = 'digital_doc';
      try {
        const ast = await extractFromDoc(file.buffer, file.originalName);
        ast.metadata.originalFileSha256 = file.sha256;
        result = { ast, routeTaken: 'digital_doc' };
      } catch (docErr) {
        log().warn({ err: docErr }, 'Legacy DOC parser failed, attempting fallback to DOCX parser');
        const ast = await extractFromDocx(file.buffer, file.originalName);
        ast.metadata.originalFileSha256 = file.sha256;
        result = { ast, routeTaken: 'digital_docx' };
        route = 'digital_docx';
      }
    } else if (
      // Route 1b: Modern DOCX files
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx' ||
      name.endsWith('.docx')
    ) {
      route = 'digital_docx';
      try {
        const ast = await extractFromDocx(file.buffer, file.originalName);
        ast.metadata.originalFileSha256 = file.sha256;
        result = { ast, routeTaken: 'digital_docx' };
      } catch (docxErr) {
        log().warn({ err: docxErr }, 'DOCX parser failed, attempting fallback to legacy DOC parser');
        const ast = await extractFromDoc(file.buffer, file.originalName);
        ast.metadata.originalFileSha256 = file.sha256;
        result = { ast, routeTaken: 'digital_doc' };
        route = 'digital_doc';
      }
    } else if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      // Route 2: PDF files
      const digitalResult = await extractFromDigitalPdf(file.buffer, file.originalName);

      if (digitalResult.isDigital && digitalResult.ast) {
        route = 'digital_pdf';
        digitalResult.ast.metadata.originalFileSha256 = file.sha256;
        result = {
          ast: digitalResult.ast,
          routeTaken: 'digital_pdf',
          pageCount: digitalResult.pageCount,
        };
      } else {
        route = 'vlm_ocr';
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
          mime,
          file.originalName,
          digitalResult.pageCount
        );
        ast.metadata.originalFileSha256 = file.sha256;
        result = {
          ast,
          routeTaken: 'vlm_ocr',
          pageCount: digitalResult.pageCount,
        };
      }
    } else {
      // Route 3: Images -> VLM Route
      route = 'vlm_ocr';
      const ast = await extractWithVlm(file.buffer, mime, file.originalName, 1);
      ast.metadata.originalFileSha256 = file.sha256;
      result = {
        ast,
        routeTaken: 'vlm_ocr',
      };
    }

    documentId = result.ast.id;
    pageCount = result.pageCount ?? result.ast.sections?.length ?? 1;
    const totalDurationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;

    // ONE INFO summary line per document at the end of processing
    log().info(
      {
        documentId,
        route: result.routeTaken,
        totalDurationMs,
        pages: pageCount,
        outcome: 'success',
      },
      'Document extraction completed'
    );

    return result;
  } catch (err: unknown) {
    const totalDurationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;

    // ONE INFO summary line on failure
    log().info(
      {
        documentId,
        route,
        totalDurationMs,
        pages: pageCount,
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
