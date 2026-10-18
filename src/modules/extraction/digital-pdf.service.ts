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
  nonDigitalReason?: string;
  ast?: CanonicalDocument;
}

/**
 * Inspects a PDF buffer. If it contains a complete digital text layer across all pages,
 * extracts paragraphs and headings directly into a CanonicalDocument AST.
 * If scanned, empty, or hybrid (mixed scanned/digital pages), returns isDigital: false
 * so the router can safely divert to Gemini VLM without dropping non-digital pages.
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

    throw err;
  }

  const numPages = pdfDoc.numPages;
  let totalCharacters = 0;
  const blocks: DocumentBlock[] = [];
  const nonDigitalPages: Array<{ pageNum: number; characters: number; hasImages: boolean }> = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();

    let pageCharacters = 0;
    let currentLine = '';
    const pageLines: string[] = [];

    for (const item of content.items) {
      if ('str' in item) {
        const text = (item as { str: string }).str;
        if (text) {
          pageCharacters += text.length;
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

    // Inspect operator list for image XObjects
    const hasImages = ops.fnArray.some(
      (op) =>
        op === pdfjsLib.OPS.paintImageXObject ||
        op === pdfjsLib.OPS.paintInlineImageXObject ||
        op === pdfjsLib.OPS.paintImageMaskXObject ||
        op === pdfjsLib.OPS.paintImageMaskXObjectGroup ||
        op === pdfjsLib.OPS.paintInlineImageXObjectGroup
    );

    // A page is non-digital (scanned, image, or empty) if:
    // 1. Text count is below 40 chars (scanned image, blank page, or single header/footer)
    // 2. Contains embedded images and has sparse text (< 200 chars, e.g. exhibit with title)
    if (pageCharacters < 40 || (hasImages && pageCharacters < 200)) {
      nonDigitalPages.push({
        pageNum,
        characters: pageCharacters,
        hasImages,
      });
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

  // Triage check: To qualify as pure digital, ALL pages must have digital text
  // If ANY page is scanned, blank, or an unextractable image, route to Gemini VLM
  const avgCharsPerPage = totalCharacters / (numPages || 1);
  let isDigital = true;
  let nonDigitalReason: string | undefined;

  if (totalCharacters < 50) {
    isDigital = false;
    nonDigitalReason = `Insufficient text content (${totalCharacters} chars across ${numPages} pages)`;
  } else if (avgCharsPerPage < 50) {
    isDigital = false;
    nonDigitalReason = `Low average character density (${Math.round(avgCharsPerPage)} chars/page across ${numPages} pages)`;
  } else if (nonDigitalPages.length > 0) {
    isDigital = false;
    const pageDetails = nonDigitalPages
      .map((p) => `p.${p.pageNum} (${p.characters} chars${p.hasImages ? ', image' : ''})`)
      .join(', ');
    nonDigitalReason = `PDF contains ${nonDigitalPages.length} scanned/image page(s) missing digital text: ${pageDetails}`;
  }

  if (!isDigital) {
    return {
      isDigital: false,
      pageCount: numPages,
      totalCharacters,
      nonDigitalReason,
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
