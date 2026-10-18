import { z } from 'zod';
import { CanonicalDocument } from './canonical.types.js';

export const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  superscript: z.boolean().optional(),
  subscript: z.boolean().optional(),
  code: z.boolean().optional(),
  citationId: z.string().optional(),
});

export const headingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  text: z.string(),
  numberedPrefix: z.string().optional(),
});

export const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  runs: z.array(textRunSchema),
  alignment: z.enum(['left', 'center', 'right', 'justify']).optional(),
});

export const tableCellSchema = z.object({
  runs: z.array(textRunSchema),
  colSpan: z.number().int().positive().optional(),
  rowSpan: z.number().int().positive().optional(),
  alignment: z.enum(['left', 'center', 'right']).optional(),
  backgroundColorHex: z.string().optional(),
});

export const tableRowSchema = z.object({
  cells: z.array(tableCellSchema),
});

export const tableBlockSchema = z.object({
  type: z.literal('table'),
  caption: z.string().optional(),
  columnWidthsPercentage: z.array(z.number()).optional(),
  headerRows: z.array(tableRowSchema),
  bodyRows: z.array(tableRowSchema),
});

export const calloutBlockSchema = z.object({
  type: z.literal('callout'),
  intent: z.enum(['info', 'warning', 'legal_notice']),
  runs: z.array(textRunSchema),
});

export const pageBreakBlockSchema = z.object({
  type: z.literal('page_break'),
});

// For recursive lists
export const listItemSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    runs: z.array(textRunSchema),
    subList: listBlockSchema.optional(),
  })
);

export const listBlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(listItemSchema),
  })
);

export const documentBlockSchema = z.union([
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  calloutBlockSchema,
  pageBreakBlockSchema,
]);

export const documentSectionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  blocks: z.array(documentBlockSchema),
});

export const legalCitationSchema = z.object({
  id: z.string(),
  citationType: z.enum(['case', 'statute', 'regulation', 'contract_clause']),
  formalCitation: z.string(),
  pinCite: z.string().optional(),
  url: z.string().optional(),
  footnoteIndex: z.number().optional(),
});

export const documentMetadataSchema = z.object({
  author: z.string().optional(),
  clientMatterNumber: z.string().optional(),
  jurisdiction: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  originalFileName: z.string().optional(),
  originalFileSha256: z.string().optional(),
});

export const documentStylingSchema = z.object({
  pageSize: z.enum(['LETTER', 'LEGAL', 'A4']).default('LETTER'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins: z
    .object({
      topPt: z.number().default(72),
      bottomPt: z.number().default(72),
      leftPt: z.number().default(72),
      rightPt: z.number().default(72),
    })
    .default({ topPt: 72, bottomPt: 72, leftPt: 72, rightPt: 72 }),
  typography: z
    .object({
      fontFamily: z.string().default('Calibri'),
      baseFontSizePt: z.number().default(11),
      lineHeight: z.number().default(1.25),
    })
    .default({ fontFamily: 'Calibri', baseFontSizePt: 11, lineHeight: 1.25 }),
  headerFooter: z
    .object({
      headerTextLeft: z.string().optional(),
      headerTextRight: z.string().optional(),
      footerTextLeft: z.string().optional(),
      footerPageNumbering: z
        .enum(['PAGE_X_OF_Y', 'PAGE_X', 'NONE'])
        .default('PAGE_X_OF_Y'),
      differentFirstPage: z.boolean().default(false),
    })
    .default({
      footerPageNumbering: 'PAGE_X_OF_Y',
      differentFirstPage: false,
    }),
});

export const canonicalDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.string().default('2.0.0'),
  revisionId: z.string(),
  metadata: documentMetadataSchema,
  styling: documentStylingSchema,
  sections: z.array(documentSectionSchema),
  citations: z.array(legalCitationSchema).default([]),
});

export function validateCanonicalDocument(data: unknown): CanonicalDocument {
  return canonicalDocumentSchema.parse(data) as CanonicalDocument;
}

export function createDefaultCanonicalDocument(title: string, originalFileName?: string): CanonicalDocument {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    version: '2.0.0',
    revisionId: crypto.randomUUID(),
    metadata: {
      createdAt: now,
      updatedAt: now,
      originalFileName,
    },
    styling: {
      pageSize: 'LETTER',
      orientation: 'portrait',
      margins: { topPt: 72, bottomPt: 72, leftPt: 72, rightPt: 72 },
      typography: { fontFamily: 'Calibri', baseFontSizePt: 11, lineHeight: 1.25 },
      headerFooter: {
        headerTextRight: title,
        footerPageNumbering: 'PAGE_X_OF_Y',
        differentFirstPage: false,
      },
    },
    sections: [
      {
        id: crypto.randomUUID(),
        blocks: [],
      },
    ],
    citations: [],
  };
}
