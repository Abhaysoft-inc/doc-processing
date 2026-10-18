import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Header,
  Footer,
  PageNumber,
  Packer,
  AlignmentType,
  BorderStyle,
  FootnoteReferenceRun,
} from 'docx';
import {
  CanonicalDocument,
  DocumentBlock,
  TextRun as AstTextRun,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  TableBlock,
  CalloutBlock,
} from '../canonical/canonical.types.js';
import { log } from '../../shared/context.js';

export async function generateDocxBuffer(doc: CanonicalDocument): Promise<Buffer> {
  const startHr = process.hrtime.bigint();
  // Build footnote registry from doc.citations
  const footnotesMap: Record<number, { children: Paragraph[] }> = {};
  const citationToFootnoteId = new Map<string, number>();

  if (doc.citations && doc.citations.length > 0) {
    doc.citations.forEach((cit, index) => {
      const footnoteId = cit.footnoteIndex || index + 1;
      citationToFootnoteId.set(cit.id, footnoteId);
      const citeText = cit.pinCite
        ? `${cit.formalCitation} ${cit.pinCite}`
        : cit.formalCitation;
      footnotesMap[footnoteId] = {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: citeText,
                size: 18, // 9pt
              }),
            ],
          }),
        ],
      };
    });
  }

  const mapAlignment = (align?: 'left' | 'center' | 'right' | 'justify'): (typeof AlignmentType)[keyof typeof AlignmentType] => {
    switch (align) {
      case 'center':
        return AlignmentType.CENTER;
      case 'right':
        return AlignmentType.RIGHT;
      case 'justify':
        return AlignmentType.JUSTIFIED;
      default:
        return AlignmentType.LEFT;
    }
  };

  const mapRuns = (runs: AstTextRun[]): (TextRun | FootnoteReferenceRun)[] => {
    const docxRuns: (TextRun | FootnoteReferenceRun)[] = [];
    for (const r of runs) {
      docxRuns.push(
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic,
          underline: r.underline ? {} : undefined,
          strike: r.strikethrough,
          superScript: r.superscript,
          subScript: r.subscript,
          font: doc.styling.typography.fontFamily || 'Calibri',
          size: (doc.styling.typography.baseFontSizePt || 11) * 2, // half-points in OOXML
        })
      );

      // If text run points to a citation, inject FootnoteReferenceRun
      if (r.citationId && citationToFootnoteId.has(r.citationId)) {
        const footnoteId = citationToFootnoteId.get(r.citationId)!;
        docxRuns.push(new FootnoteReferenceRun(footnoteId));
      }
    }
    return docxRuns;
  };

  const mapBlock = (block: DocumentBlock): (Paragraph | Table)[] => {
    switch (block.type) {
      case 'heading': {
        const hBlock = block as HeadingBlock;
        const headingMap = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4,
          HeadingLevel.HEADING_5,
          HeadingLevel.HEADING_6,
        ];
        const headingText = hBlock.numberedPrefix
          ? `${hBlock.numberedPrefix} ${hBlock.text}`
          : hBlock.text;

        return [
          new Paragraph({
            text: headingText,
            heading: headingMap[hBlock.level - 1] || HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          }),
        ];
      }

      case 'paragraph': {
        const pBlock = block as ParagraphBlock;
        return [
          new Paragraph({
            children: mapRuns(pBlock.runs),
            alignment: mapAlignment(pBlock.alignment),
            spacing: {
              line: Math.round((doc.styling.typography.lineHeight || 1.25) * 240),
              before: 60,
              after: 60,
            },
          }),
        ];
      }

      case 'list': {
        const lBlock = block as ListBlock;
        const listParagraphs: Paragraph[] = [];
        lBlock.items.forEach((item, itemIdx) => {
          listParagraphs.push(
            new Paragraph({
              children: mapRuns(item.runs),
              bullet: lBlock.ordered ? undefined : { level: 0 },
              numbering: lBlock.ordered
                ? {
                    reference: 'default-numbering',
                    level: 0,
                  }
                : undefined,
              spacing: { before: 40, after: 40 },
            })
          );
        });
        return listParagraphs;
      }

      case 'table': {
        const tBlock = block as TableBlock;
        const rows: TableRow[] = [];

        // Header Rows
        for (const hRow of tBlock.headerRows) {
          rows.push(
            new TableRow({
              tableHeader: true,
              children: hRow.cells.map(
                (c) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: mapRuns(c.runs),
                        alignment: mapAlignment(c.alignment),
                      }),
                    ],
                    shading: { fill: c.backgroundColorHex || 'F3F4F6' },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                      bottom: { style: BorderStyle.SINGLE, size: 2, color: '9CA3AF' },
                      left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                      right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
                    },
                  })
              ),
            })
          );
        }

        // Body Rows
        for (const bRow of tBlock.bodyRows) {
          rows.push(
            new TableRow({
              children: bRow.cells.map(
                (c) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: mapRuns(c.runs),
                        alignment: mapAlignment(c.alignment),
                      }),
                    ],
                    shading: c.backgroundColorHex ? { fill: c.backgroundColorHex } : undefined,
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
                      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
                      left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
                      right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
                    },
                  })
              ),
            })
          );
        }

        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          }),
        ];
      }

      case 'callout': {
        const cBlock = block as CalloutBlock;
        const borderColor =
          cBlock.intent === 'warning'
            ? 'F59E0B'
            : cBlock.intent === 'legal_notice'
            ? '3B82F6'
            : '10B981';

        const bgColor =
          cBlock.intent === 'warning'
            ? 'FEF3C7'
            : cBlock.intent === 'legal_notice'
            ? 'EFF6FF'
            : 'F0FDF4';

        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: mapRuns(cBlock.runs),
                        spacing: { before: 80, after: 80 },
                      }),
                    ],
                    shading: { fill: bgColor },
                    borders: {
                      left: { style: BorderStyle.SINGLE, size: 24, color: borderColor },
                      top: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.NONE },
                    },
                  }),
                ],
              }),
            ],
          }),
        ];
      }

      case 'page_break': {
        return [
          new Paragraph({
            pageBreakBefore: true,
          }),
        ];
      }

      default:
        return [];
    }
  };

  // Convert points to twips (1 pt = 20 twips)
  const margins = {
    top: (doc.styling.margins?.topPt ?? 72) * 20,
    bottom: (doc.styling.margins?.bottomPt ?? 72) * 20,
    left: (doc.styling.margins?.leftPt ?? 72) * 20,
    right: (doc.styling.margins?.rightPt ?? 72) * 20,
  };

  const sections = doc.sections.map((sec) => {
    const children: (Paragraph | Table)[] = [];

    if (sec.title) {
      children.push(
        new Paragraph({
          text: sec.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    }

    for (const block of sec.blocks) {
      children.push(...mapBlock(block));
    }

    return {
      properties: {
        page: {
          margin: margins,
          pageNumbers: { start: 1 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: doc.styling.headerFooter.headerTextRight || doc.title,
                  size: 18, // 9pt
                  color: '888888',
                  font: doc.styling.typography.fontFamily || 'Calibri',
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: 'Page ',
                  size: 18,
                  font: doc.styling.typography.fontFamily || 'Calibri',
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 18,
                  font: doc.styling.typography.fontFamily || 'Calibri',
                }),
                new TextRun({
                  text: ' of ',
                  size: 18,
                  font: doc.styling.typography.fontFamily || 'Calibri',
                }),
                new TextRun({
                  children: [PageNumber.TOTAL_PAGES],
                  size: 18,
                  font: doc.styling.typography.fontFamily || 'Calibri',
                }),
              ],
            }),
          ],
        }),
      },
      children,
    };
  });

  const wordDoc = new Document({
    footnotes: Object.keys(footnotesMap).length > 0 ? footnotesMap : undefined,
    sections,
  });

  const buffer = await Packer.toBuffer(wordDoc);
  const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;

  // Per-call detail at DEBUG
  log().debug(
    {
      format: 'docx',
      durationMs,
      outputSizeBytes: buffer.length,
    },
    'DOCX buffer compiled'
  );

  // One INFO summary per generated document
  log().info(
    {
      documentId: doc.id,
      format: 'docx',
      durationMs,
      outputSizeBytes: buffer.length,
      outcome: 'success',
    },
    'Document generation completed'
  );

  return buffer;
}
