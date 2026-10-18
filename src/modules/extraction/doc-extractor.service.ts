import WordExtractor from 'word-extractor';
import crypto from 'node:crypto';
import {
  CanonicalDocument,
  DocumentBlock,
  ParagraphBlock,
  HeadingBlock,
  TableBlock,
  ListBlock,
} from '../canonical/canonical.types.js';
import { createDefaultCanonicalDocument } from '../canonical/canonical.schema.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

/**
 * Deterministically extracts text, tables, headings, and lists from legacy Word .doc files (CFBF).
 */
export async function extractFromDoc(
  buffer: Buffer,
  originalFileName: string
): Promise<CanonicalDocument> {
  const startHr = process.hrtime.bigint();
  const documentId = crypto.randomUUID();

  let extractedDoc: Awaited<ReturnType<WordExtractor['extract']>>;

  try {
    const extractor = new WordExtractor();
    extractedDoc = await extractor.extract(buffer);
  } catch (err: unknown) {
    const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();

    if (
      errMsg.includes('encrypted') ||
      errMsg.includes('password') ||
      errMsg.includes('corrupt') ||
      errMsg.includes('cfbf') ||
      errMsg.includes('invalid')
    ) {
      log().warn({ documentId, stage: 'doc_extraction', error: errMsg }, 'Corrupt or password-protected legacy DOC file');
      throw new AppError('CORRUPT_DOCUMENT', 'The legacy DOC file is corrupt or encrypted.', 422, true);
    }

    throw err;
  }

  const bodyText = extractedDoc.getBody() || '';
  const headers = extractedDoc.getHeaders() || '';
  const footers = extractedDoc.getFooters() || '';
  const footnotes = extractedDoc.getFootnotes() || '';

  const title = originalFileName.replace(/\.[^/.]+$/, '');
  const ast = createDefaultCanonicalDocument(title, originalFileName);
  ast.id = documentId;

  // Set running header/footer if present in .doc
  const cleanHeader = headers.trim().split(/\r?\n/)[0]?.trim();
  if (cleanHeader) {
    ast.styling.headerFooter.headerTextRight = cleanHeader.slice(0, 100);
  }
  const cleanFooter = footers.trim().split(/\r?\n/)[0]?.trim();
  if (cleanFooter) {
    ast.styling.headerFooter.footerTextLeft = cleanFooter.slice(0, 100);
  }

  const lines = bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: DocumentBlock[] = [];
  let currentTableRows: string[][] = [];

  const flushTable = () => {
    if (currentTableRows.length === 0) return;

    // First row as header, remaining as body
    const headerRow = currentTableRows[0];
    const bodyRows = currentTableRows.slice(1);

    const tableBlock: TableBlock = {
      type: 'table',
      headerRows: [
        {
          cells: headerRow.map((cellText) => ({
            runs: [{ text: cellText.trim(), bold: true }],
          })),
        },
      ],
      bodyRows: (bodyRows.length > 0 ? bodyRows : [headerRow]).map((row) => ({
        cells: row.map((cellText) => ({
          runs: [{ text: cellText.trim() }],
        })),
      })),
    };

    blocks.push(tableBlock);
    currentTableRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line represents a tab-delimited table row
    if (line.includes('\t')) {
      const cells = line
        .split('\t')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length > 1) {
        currentTableRows.push(cells);
        continue;
      }
    }

    // Flush any accumulated table rows before processing non-table blocks
    flushTable();

    // Check if line is a semantic heading
    const isUppercaseHeading =
      line.length >= 3 &&
      line.length <= 90 &&
      line === line.toUpperCase() &&
      /[A-Z]/.test(line);

    const isPrefixedHeading =
      /^(SECTION|ARTICLE|SCHEDULE|ANNEXURE|CHAPTER|NOTICE|PART|APPENDIX)\b/i.test(line);

    const isNumberedHeading = /^([0-9]+\.[0-9]*\s+[A-Z])/.test(line);

    if (isUppercaseHeading || isPrefixedHeading || isNumberedHeading) {
      const level =
        isUppercaseHeading && line.length < 50 ? 1 : isPrefixedHeading ? 2 : 3;
      const heading: HeadingBlock = {
        type: 'heading',
        level,
        text: line,
      };
      blocks.push(heading);
      continue;
    }

    // Check if line is a list item
    const bulletMatch = line.match(/^([*•\-–]|\([a-z0-9]+\)|[0-9]+[.)])\s+(.*)$/i);
    if (bulletMatch) {
      const isOrdered = /^[0-9]+[.)]|\([0-9]+\)/.test(bulletMatch[1]);
      const listBlock: ListBlock = {
        type: 'list',
        ordered: isOrdered,
        items: [
          {
            runs: [{ text: bulletMatch[2] || line }],
          },
        ],
      };
      blocks.push(listBlock);
      continue;
    }

    // Standard paragraph block
    const paragraph: ParagraphBlock = {
      type: 'paragraph',
      runs: [{ text: line }],
    };
    blocks.push(paragraph);
  }

  flushTable();

  // If no blocks were extracted, fallback to single paragraph
  if (blocks.length === 0) {
    blocks.push({
      type: 'paragraph',
      runs: [{ text: 'No text content found in document.' }],
    });
  }

  // Capture document footnotes if present
  if (footnotes.trim()) {
    const fnLines = footnotes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    fnLines.forEach((fn, idx) => {
      ast.citations.push({
        id: `cite_${idx + 1}`,
        citationType: 'contract_clause',
        formalCitation: fn,
        footnoteIndex: idx + 1,
      });
    });
  }

  ast.sections = [
    {
      id: crypto.randomUUID(),
      blocks,
    },
  ];

  return ast;
}
