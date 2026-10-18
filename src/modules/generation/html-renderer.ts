import sanitizeHtml from 'sanitize-html';
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

export function renderCanonicalToHtml(doc: CanonicalDocument): string {
  const sanitize = (text: string) =>
    sanitizeHtml(text, {
      allowedTags: [],
      allowedAttributes: {},
    });

  // Map citation ID to footnote index
  const citationIndexMap = new Map<string, number>();
  doc.citations.forEach((cit, idx) => {
    citationIndexMap.set(cit.id, cit.footnoteIndex || idx + 1);
  });

  const renderRuns = (runs: TextRun[]): string => {
    return runs
      .map((r) => {
        let content = sanitize(r.text);
        if (r.bold) content = `<strong>${content}</strong>`;
        if (r.italic) content = `<em>${content}</em>`;
        if (r.underline) content = `<u>${content}</u>`;
        if (r.strikethrough) content = `<s>${content}</s>`;
        if (r.code) content = `<code>${content}</code>`;
        if (r.superscript) content = `<sup>${content}</sup>`;
        if (r.subscript) content = `<sub>${content}</sub>`;

        if (r.citationId && citationIndexMap.has(r.citationId)) {
          const num = citationIndexMap.get(r.citationId);
          content += `<sup class="citation-mark">[${num}]</sup>`;
        }
        return content;
      })
      .join('');
  };

  const renderBlock = (block: DocumentBlock): string => {
    switch (block.type) {
      case 'heading': {
        const h = block as HeadingBlock;
        const tag = `h${h.level}`;
        const prefix = h.numberedPrefix ? `${sanitize(h.numberedPrefix)} ` : '';
        return `<${tag}>${prefix}${sanitize(h.text)}</${tag}>`;
      }

      case 'paragraph': {
        const p = block as ParagraphBlock;
        const alignStyle = p.alignment ? ` style="text-align: ${p.alignment};"` : '';
        return `<p${alignStyle}>${renderRuns(p.runs)}</p>`;
      }

      case 'list': {
        const l = block as ListBlock;
        const tag = l.ordered ? 'ol' : 'ul';
        const itemsHtml = l.items
          .map((item) => {
            let itemContent = renderRuns(item.runs);
            if (item.subList) {
              itemContent += renderBlock(item.subList);
            }
            return `<li>${itemContent}</li>`;
          })
          .join('\n');
        return `<${tag}>${itemsHtml}</${tag}>`;
      }

      case 'table': {
        const t = block as TableBlock;
        let html = '<table class="canonical-table">';
        if (t.caption) {
          html += `<caption>${sanitize(t.caption)}</caption>`;
        }

        if (t.headerRows.length > 0) {
          html += '<thead>';
          for (const row of t.headerRows) {
            html += '<tr>';
            for (const cell of row.cells) {
              const bg = cell.backgroundColorHex ? `background-color: #${cell.backgroundColorHex};` : '';
              const align = cell.alignment ? `text-align: ${cell.alignment};` : '';
              const style = bg || align ? ` style="${bg}${align}"` : '';
              const colSpan = cell.colSpan ? ` colspan="${cell.colSpan}"` : '';
              const rowSpan = cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : '';
              html += `<th${style}${colSpan}${rowSpan}>${renderRuns(cell.runs)}</th>`;
            }
            html += '</tr>';
          }
          html += '</thead>';
        }

        if (t.bodyRows.length > 0) {
          html += '<tbody>';
          for (const row of t.bodyRows) {
            html += '<tr>';
            for (const cell of row.cells) {
              const bg = cell.backgroundColorHex ? `background-color: #${cell.backgroundColorHex};` : '';
              const align = cell.alignment ? `text-align: ${cell.alignment};` : '';
              const style = bg || align ? ` style="${bg}${align}"` : '';
              const colSpan = cell.colSpan ? ` colspan="${cell.colSpan}"` : '';
              const rowSpan = cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : '';
              html += `<td${style}${colSpan}${rowSpan}>${renderRuns(cell.runs)}</td>`;
            }
            html += '</tr>';
          }
          html += '</tbody>';
        }

        html += '</table>';
        return html;
      }

      case 'callout': {
        const c = block as CalloutBlock;
        return `<div class="callout callout-${c.intent}">${renderRuns(c.runs)}</div>`;
      }

      case 'page_break': {
        return '<div class="page-break"></div>';
      }

      default:
        return '';
    }
  };

  const sectionsHtml = doc.sections
    .map((sec) => {
      let secContent = '';
      if (sec.title) {
        secContent += `<h1>${sanitize(sec.title)}</h1>\n`;
      }
      secContent += sec.blocks.map(renderBlock).join('\n');
      return `<section class="document-section">${secContent}</section>`;
    })
    .join('\n');

  let citationsHtml = '';
  if (doc.citations && doc.citations.length > 0) {
    citationsHtml = `
      <section class="citations-section">
        <h2>References & Authorities</h2>
        <ol class="citations-list">
          ${doc.citations
            .map((cit, idx) => {
              const num = cit.footnoteIndex || idx + 1;
              const link = cit.url
                ? ` <a href="${sanitize(cit.url)}" target="_blank" rel="noopener">[Source]</a>`
                : '';
              const pin = cit.pinCite ? ` ${sanitize(cit.pinCite)}` : '';
              return `<li value="${num}"><strong>${sanitize(cit.formalCitation)}</strong>${pin}${link}</li>`;
            })
            .join('\n')}
        </ol>
      </section>
    `;
  }

  const fontFamily = doc.styling.typography.fontFamily || 'Inter, -apple-system, sans-serif';
  const fontSize = doc.styling.typography.baseFontSizePt || 11;
  const lineHeight = doc.styling.typography.lineHeight || 1.35;
  const pageSize = doc.styling.pageSize.toLowerCase();
  const orientation = doc.styling.orientation || 'portrait';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${sanitize(doc.title)}</title>
  <style>
    @page {
      size: ${pageSize} ${orientation};
      margin: ${doc.styling.margins.topPt}pt ${doc.styling.margins.rightPt}pt ${doc.styling.margins.bottomPt}pt ${doc.styling.margins.leftPt}pt;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: ${fontFamily};
      font-size: ${fontSize}pt;
      line-height: ${lineHeight};
      color: #111827;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #111827;
      margin-top: 1.2em;
      margin-bottom: 0.5em;
      page-break-after: avoid;
    }
    h1 { font-size: 1.8em; font-weight: 700; border-bottom: 1px solid #E5E7EB; padding-bottom: 0.3em; }
    h2 { font-size: 1.4em; font-weight: 600; }
    h3 { font-size: 1.15em; font-weight: 600; }
    p {
      margin-top: 0.4em;
      margin-bottom: 0.6em;
      text-align: justify;
    }
    ul, ol {
      margin-top: 0.4em;
      margin-bottom: 0.6em;
      padding-left: 1.5em;
    }
    li {
      margin-bottom: 0.3em;
    }
    .canonical-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      page-break-inside: auto;
      font-size: 0.95em;
    }
    .canonical-table th, .canonical-table td {
      border: 1px solid #D1D5DB;
      padding: 8px 12px;
      text-align: left;
    }
    .canonical-table thead {
      display: table-header-group;
      background-color: #F3F4F6;
      font-weight: 600;
    }
    .canonical-table tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    .callout {
      border-left: 4px solid #3B82F6;
      background-color: #EFF6FF;
      padding: 10px 14px;
      margin: 1em 0;
      border-radius: 2px;
      page-break-inside: avoid;
    }
    .callout-warning {
      border-left-color: #F59E0B;
      background-color: #FEF3C7;
    }
    .callout-legal_notice {
      border-left-color: #4F46E5;
      background-color: #EEF2FF;
    }
    .page-break {
      page-break-after: always;
    }
    .citation-mark {
      color: #2563EB;
      font-weight: 600;
      font-size: 0.75em;
      vertical-align: super;
      margin-left: 2px;
    }
    .citations-section {
      margin-top: 2em;
      padding-top: 1em;
      border-top: 1px solid #E5E7EB;
      page-break-before: auto;
    }
    .citations-list {
      font-size: 0.85em;
      color: #374151;
    }
  </style>
</head>
<body>
  ${sectionsHtml}
  ${citationsHtml}
</body>
</html>`;
}
