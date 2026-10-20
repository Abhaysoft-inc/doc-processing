import {
  CanonicalDocument,
  DocumentBlock,
  TextRun,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  TableBlock,
  CalloutBlock,
} from '../canonical/canonical.types.js';

/**
 * Formats a TextRun into Markdown syntax, handling spacing and formatting markers.
 */
function formatTextRun(run: TextRun, citationIndexMap: Map<string, number>): string {
  let text = run.text ?? '';
  if (!text) return '';

  // Extract leading and trailing whitespace so markers don't wrap whitespace (e.g. " **word** " instead of "** word **")
  const leadingMatch = text.match(/^\s+/);
  const trailingMatch = text.match(/\s+$/);
  const leadingWs = leadingMatch ? leadingMatch[0] : '';
  const trailingWs = trailingMatch ? trailingMatch[0] : '';
  let core = text.trim();

  if (!core) {
    return text; // Pure whitespace run
  }

  if (run.code) core = `\`${core}\``;
  if (run.bold && run.italic) core = `***${core}***`;
  else if (run.bold) core = `**${core}**`;
  else if (run.italic) core = `*${core}*`;
  if (run.strikethrough) core = `~~${core}~~`;
  if (run.underline) core = `<u>${core}</u>`;
  if (run.superscript) core = `<sup>${core}</sup>`;
  if (run.subscript) core = `<sub>${core}</sub>`;

  if (run.citationId && citationIndexMap.has(run.citationId)) {
    const num = citationIndexMap.get(run.citationId);
    core += `[^${num}]`;
  }

  return `${leadingWs}${core}${trailingWs}`;
}

/**
 * Renders an array of TextRuns into a Markdown string.
 */
function renderRuns(runs: TextRun[], citationIndexMap: Map<string, number>): string {
  if (!runs || runs.length === 0) return '';
  return runs.map((r) => formatTextRun(r, citationIndexMap)).join('');
}

/**
 * Sanitizes cell text for GitHub-Flavored Markdown tables:
 * - Escapes pipes ('|' -> '\|')
 * - Replaces newlines with HTML breaks ('<br>') to keep table rows on a single line
 */
function formatTableCell(runs: TextRun[], citationIndexMap: Map<string, number>): string {
  const content = renderRuns(runs, citationIndexMap);
  return content
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

/**
 * Renders a ListBlock with nested sublists and proper indentation.
 */
function renderListBlock(
  list: ListBlock,
  citationIndexMap: Map<string, number>,
  indent = 0
): string {
  const indentStr = ' '.repeat(indent);
  const lines: string[] = [];

  list.items.forEach((item, index) => {
    const marker = list.ordered ? `${index + 1}.` : '-';
    const text = renderRuns(item.runs, citationIndexMap);
    lines.push(`${indentStr}${marker} ${text}`);

    if (item.subList) {
      lines.push(renderListBlock(item.subList, citationIndexMap, indent + 4));
    }
  });

  return lines.join('\n');
}

/**
 * Renders a TableBlock into a GitHub-Flavored Markdown table with alignment indicators.
 */
function renderTableBlock(table: TableBlock, citationIndexMap: Map<string, number>): string {
  const lines: string[] = [];

  if (table.caption) {
    lines.push(`*Table: ${table.caption}*\n`);
  }

  const allRows = [...(table.headerRows || []), ...(table.bodyRows || [])];
  if (allRows.length === 0) {
    return '';
  }

  // Determine maximum column count
  const maxCols = Math.max(...allRows.map((r) => r.cells.length), 1);

  // Determine headers
  let headerCells: string[] = [];
  let bodyStartIndex = 0;

  if (table.headerRows && table.headerRows.length > 0) {
    headerCells = table.headerRows[0].cells.map((c) => formatTableCell(c.runs, citationIndexMap));
    bodyStartIndex = 0; // Body is in table.bodyRows
  } else if (table.bodyRows && table.bodyRows.length > 0) {
    // If no explicit header, promote the first body row to header
    headerCells = table.bodyRows[0].cells.map((c) => formatTableCell(c.runs, citationIndexMap));
    bodyStartIndex = 1;
  }

  // Pad header cells to maxCols
  while (headerCells.length < maxCols) {
    headerCells.push(`Column ${headerCells.length + 1}`);
  }

  // 1. Output Header Row
  lines.push(`| ${headerCells.join(' | ')} |`);

  // 2. Output Delimiter Row with alignment
  const delimiterCells = headerCells.map((_, colIdx) => {
    const firstRowCell = allRows[0]?.cells[colIdx];
    const align = firstRowCell?.alignment;
    if (align === 'center') return ':---:';
    if (align === 'right') return '---:';
    return ':---';
  });
  lines.push(`| ${delimiterCells.join(' | ')} |`);

  // 3. Output Body Rows
  const bodyRows = table.headerRows?.length ? table.bodyRows || [] : (table.bodyRows || []).slice(bodyStartIndex);
  for (const row of bodyRows) {
    const cells = row.cells.map((c) => formatTableCell(c.runs, citationIndexMap));
    while (cells.length < maxCols) {
      cells.push('');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * Renders a single DocumentBlock into Markdown.
 */
function renderBlock(
  block: DocumentBlock,
  citationIndexMap: Map<string, number>
): string {
  switch (block.type) {
    case 'heading': {
      const h = block as HeadingBlock;
      const level = Math.min(Math.max(h.level, 1), 6);
      const hashes = '#'.repeat(level);
      const prefix = h.numberedPrefix ? `${h.numberedPrefix.trim()} ` : '';
      return `${hashes} ${prefix}${h.text.trim()}\n`;
    }

    case 'paragraph': {
      const p = block as ParagraphBlock;
      const text = renderRuns(p.runs, citationIndexMap).trim();
      return text ? `${text}\n` : '';
    }

    case 'list': {
      const l = block as ListBlock;
      return `${renderListBlock(l, citationIndexMap)}\n`;
    }

    case 'table': {
      const t = block as TableBlock;
      return `${renderTableBlock(t, citationIndexMap)}\n`;
    }

    case 'callout': {
      const c = block as CalloutBlock;
      const text = renderRuns(c.runs, citationIndexMap).trim();
      let alertTag = 'NOTE';
      if (c.intent === 'warning') alertTag = 'WARNING';
      if (c.intent === 'legal_notice') alertTag = 'IMPORTANT';

      const calloutLines = text.split('\n').map((l) => `> ${l}`).join('\n');
      return `> [!${alertTag}]\n${calloutLines}\n`;
    }

    case 'page_break': {
      return `---\n`;
    }

    default:
      return '';
  }
}

/**
 * Serializes a CanonicalDocument AST into clean, token-efficient GitHub-Flavored Markdown (GFM).
 * Ideal for LLM context prompts, RAG retrieval, and chatbot consumption.
 */
export function renderCanonicalToMarkdown(doc: CanonicalDocument): string {
  const sectionsOut: string[] = [];

  // Map citation ID to footnote index
  const citationIndexMap = new Map<string, number>();
  (doc.citations || []).forEach((cit, idx) => {
    citationIndexMap.set(cit.id, cit.footnoteIndex || idx + 1);
  });

  // 1. Document Title
  if (doc.title) {
    sectionsOut.push(`# ${doc.title.trim()}\n`);
  }

  // 2. Sections & Blocks
  for (const section of doc.sections || []) {
    // If section has a title distinct from the document title, render section heading
    if (section.title && section.title.trim().toLowerCase() !== doc.title?.trim().toLowerCase()) {
      sectionsOut.push(`## ${section.title.trim()}\n`);
    }

    for (const block of section.blocks || []) {
      const blockMd = renderBlock(block, citationIndexMap);
      if (blockMd) {
        sectionsOut.push(blockMd);
      }
    }
  }

  // 3. Citations & References Appendix
  if (doc.citations && doc.citations.length > 0) {
    const citationLines: string[] = ['---\n', '### References & Citations\n'];
    doc.citations.forEach((cit, idx) => {
      const num = cit.footnoteIndex || idx + 1;
      let citeStr = `[^${num}]: ${cit.formalCitation}`;
      if (cit.pinCite) {
        citeStr += ` at ${cit.pinCite}`;
      }
      if (cit.url) {
        citeStr += ` [Link](${cit.url})`;
      }
      citationLines.push(`${citeStr}\n`);
    });
    sectionsOut.push(citationLines.join(''));
  }

  return sectionsOut.join('\n').trim() + '\n';
}
