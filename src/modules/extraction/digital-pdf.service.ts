import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import crypto from 'node:crypto';
import {
  CanonicalDocument,
  DocumentBlock,
  ParagraphBlock,
  HeadingBlock,
} from '../canonical/canonical.types.js';
import { createDefaultCanonicalDocument } from '../canonical/canonical.schema.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

export interface DigitalPdfExtractionResult {
  isDigital: boolean;
  pageCount: number;
  totalCharacters: number;
  ast?: CanonicalDocument;
}

/**
 * Inspects a PDF buffer. If it contains a digital text layer, extracts paragraphs and headings
 * directly into a CanonicalDocument AST. If scanned/empty, returns isDigital: false.
 */
export async function extractFromDigitalPdf(
  buffer: Buffer,
  originalFileName: string
): Promise<DigitalPdfExtractionResult> {
  const startHr = process.hrtime.bigint();
  const documentId = crypto.randomUUID();

  let pdfDoc: pdfjsLib.PDFDocumentProxy;

  try {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err: unknown) {
    const errObj = err as { name?: string; message?: string };
    const errMsg = errObj.message?.toLowerCase() || '';
    const errName = errObj.name || '';

    if (errName === 'PasswordException' || errMsg.includes('password') || errMsg.includes('encrypted')) {
      log().warn({ documentId, stage: 'digital_pdf_load', error: errObj.message }, 'Password protected PDF encountered');
      throw new AppError('CORRUPT_DOCUMENT', 'PDF is encrypted or password-protected and cannot be processed.', 422, true);
    }

    if (errName === 'InvalidPDFException' || errMsg.includes('invalid pdf') || errMsg.includes('corrupt')) {
      log().warn({ documentId, stage: 'digital_pdf_load', error: errObj.message }, 'Corrupt PDF encountered');
      throw new AppError('CORRUPT_DOCUMENT', 'The PDF document is corrupt or malformed.', 422, true);
    }

    log().error({ documentId, stage: 'digital_pdf_load', err }, 'Unexpected error opening PDF document');
    throw new AppError('EXTRACTION_FAILED', `Failed to open PDF document: ${errObj.message || 'Unknown error'}`, 500, false);
  }

  const numPages = pdfDoc.numPages;
  let totalCharacters = 0;
  const blocks: DocumentBlock[] = [];

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();

      let currentLine = '';
      const pageLines: string[] = [];

      for (const item of content.items) {
        if ('str' in item) {
          const text = (item as { str: string }).str;
          if (text) {
            totalCharacters += text.length;
            currentLine += text + ' ';
            if ((item as unknown as { hasEOL?: boolean }).hasEOL) {
              if (currentLine.trim()) {
                pageLines.push(currentLine.trim());
              }
              currentLine = '';
            }
          }
        }
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim());
      }

      // Process pageLines into paragraphs and headings
      for (const line of pageLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Simple heuristic for headings
        const isShort = trimmed.length < 80;
        const startsWithHeadingIndicator =
          /^(Section|Article|Chapter|\d+\.|\d+\.\d+)\s+/i.test(trimmed);
        const isAllUpper =
          trimmed.length > 4 &&
          trimmed === trimmed.toUpperCase() &&
          /[A-Z]/.test(trimmed);

        if ((startsWithHeadingIndicator || isAllUpper) && isShort) {
          const headingBlock: HeadingBlock = {
            type: 'heading',
            level: startsWithHeadingIndicator ? 2 : 1,
            text: trimmed,
          };
          blocks.push(headingBlock);
        } else {
          const pBlock: ParagraphBlock = {
            type: 'paragraph',
            runs: [{ text: trimmed }],
          };
          blocks.push(pBlock);
        }
      }

      // Add page break between pages
      if (pageNum < numPages) {
        blocks.push({ type: 'page_break' });
      }
    }
  } catch (extractErr) {
    log().error({ documentId, stage: 'digital_pdf_parse', err: extractErr }, 'Unexpected error extracting PDF pages');
    throw new AppError('EXTRACTION_FAILED', 'Failed to extract text streams from PDF.', 500, false);
  }

  const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;

  // If average characters per page is below 60 chars, it's likely a scanned image or empty
  const avgCharsPerPage = totalCharacters / (numPages || 1);
  const isDigital = totalCharacters > 50 && avgCharsPerPage > 40;

  log().debug(
    {
      documentId,
      stage: 'digital_pdf_inspection',
      durationMs,
      pages: numPages,
      isDigital,
      totalCharacters,
    },
    'Completed digital PDF stream inspection'
  );

  if (!isDigital) {
    return {
      isDigital: false,
      pageCount: numPages,
      totalCharacters,
    };
  }

  const title = originalFileName.replace(/\.[^/.]+$/, '');
  const ast = createDefaultCanonicalDocument(title, originalFileName);
  ast.id = documentId;
  ast.sections = [
    {
      id: crypto.randomUUID(),
      blocks,
    },
  ];

  return {
    isDigital: true,
    pageCount: numPages,
    totalCharacters,
    ast,
  };
}
