import mammoth from 'mammoth';
import crypto from 'node:crypto';
import {
  CanonicalDocument,
  DocumentBlock,
  ParagraphBlock,
  HeadingBlock,
  TableBlock,
  TableRow,
  TableCell,
  TextRun,
  ListBlock,
} from '../canonical/canonical.types.js';
import { createDefaultCanonicalDocument } from '../canonical/canonical.schema.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

export async function extractFromDocx(
  buffer: Buffer,
  originalFileName: string
): Promise<CanonicalDocument> {
  const documentId = crypto.randomUUID();

  let html = '';

  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch (err: unknown) {
    const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();

    if (errMsg.includes('encrypted') || errMsg.includes('password') || errMsg.includes('corrupt') || errMsg.includes('zip')) {
      log().warn({ documentId, stage: 'docx_conversion', error: errMsg }, 'Corrupt or password-protected DOCX file');
      throw new AppError('CORRUPT_DOCUMENT', 'The DOCX file is corrupt or encrypted.', 422, true);
    }

    throw err;
  }

  const title = originalFileName.replace(/\.[^/.]+$/, '');
  const ast = createDefaultCanonicalDocument(title, originalFileName);
  ast.id = documentId;

  const blocks: DocumentBlock[] = [];

  // Match tags like <h1>..</h1>, <p>..</p>, <table>..</table>, <ul>..</ul>, <ol>..</ol>
  const tagRegex = /<(h[1-6]|p|table|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerHtml = match[2];

    if (tagName.startsWith('h')) {
      const level = parseInt(tagName[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
      const cleanText = innerHtml.replace(/<[^>]+>/g, '').trim();
      if (cleanText) {
        const heading: HeadingBlock = {
          type: 'heading',
          level,
          text: cleanText,
        };
        blocks.push(heading);
      }
    } else if (tagName === 'p') {
      const runs = parseInlineRuns(innerHtml);
      if (runs.length > 0 && runs.some((r) => r.text.trim().length > 0)) {
        const paragraph: ParagraphBlock = {
          type: 'paragraph',
          runs,
        };
        blocks.push(paragraph);
      }
    } else if (tagName === 'ul' || tagName === 'ol') {
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      const items: { runs: TextRun[] }[] = [];

      while ((liMatch = liRegex.exec(innerHtml)) !== null) {
        const liRuns = parseInlineRuns(liMatch[1]);
        if (liRuns.length > 0) {
          items.push({ runs: liRuns });
        }
      }

      if (items.length > 0) {
        const listBlock: ListBlock = {
          type: 'list',
          ordered: tagName === 'ol',
          items,
        };
        blocks.push(listBlock);
      }
    } else if (tagName === 'table') {
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      const headerRows: TableRow[] = [];
      const bodyRows: TableRow[] = [];
      let isFirstRow = true;

      while ((trMatch = trRegex.exec(innerHtml)) !== null) {
        const rowContent = trMatch[1];
        const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
        let cellMatch: RegExpExecArray | null;
        const cells: TableCell[] = [];
        let isHeaderRow = false;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          if (cellMatch[1].toLowerCase() === 'th') {
            isHeaderRow = true;
          }
          const cellRuns = parseInlineRuns(cellMatch[2]);
          cells.push({
            runs: cellRuns.length > 0 ? cellRuns : [{ text: '' }],
          });
        }

        if (cells.length > 0) {
          if (isHeaderRow || isFirstRow) {
            headerRows.push({ cells });
            isFirstRow = false;
          } else {
            bodyRows.push({ cells });
          }
        }
      }

      if (headerRows.length > 0 || bodyRows.length > 0) {
        const tableBlock: TableBlock = {
          type: 'table',
          headerRows,
          bodyRows,
        };
        blocks.push(tableBlock);
      }
    }
  }

  // Fallback: If no blocks parsed, extract raw text
  if (blocks.length === 0) {
    const raw = await mammoth.extractRawText({ buffer });
    const lines = raw.value.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      blocks.push({
        type: 'paragraph',
        runs: [{ text: line.trim() }],
      });
    }
  }

  ast.sections = [
    {
      id: crypto.randomUUID(),
      blocks,
    },
  ];

  return ast;
}

function parseInlineRuns(htmlFragment: string): TextRun[] {
  const tokens = htmlFragment
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '|||BOLD|||$1|||/BOLD|||')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '|||ITALIC|||$1|||/ITALIC|||')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '|||UNDERLINE|||$1|||/UNDERLINE|||')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '|||CODE|||$1|||/CODE|||')
    .replace(/<br\s*\/?>/gi, '\n');

  const cleanText = tokens.replace(/<[^>]+>/g, '');

  const runs: TextRun[] = [];
  const parts = cleanText.split(/(\|\|\|(?:BOLD|\/BOLD|ITALIC|\/ITALIC|UNDERLINE|\/UNDERLINE|CODE|\/CODE)\|\|\|)/);

  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isCode = false;

  for (const part of parts) {
    if (part === '|||BOLD|||') isBold = true;
    else if (part === '|||/BOLD|||') isBold = false;
    else if (part === '|||ITALIC|||') isItalic = true;
    else if (part === '|||/ITALIC|||') isItalic = false;
    else if (part === '|||UNDERLINE|||') isUnderline = true;
    else if (part === '|||/UNDERLINE|||') isUnderline = false;
    else if (part === '|||CODE|||') isCode = true;
    else if (part === '|||/CODE|||') isCode = false;
    else if (part) {
      runs.push({
        text: part,
        bold: isBold || undefined,
        italic: isItalic || undefined,
        underline: isUnderline || undefined,
        code: isCode || undefined,
      });
    }
  }

  return runs;
}
