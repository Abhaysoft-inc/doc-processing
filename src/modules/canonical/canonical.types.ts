export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  code?: boolean;
  citationId?: string; // References a LegalCitation by id
}

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  numberedPrefix?: string; // e.g. "Section 1.1", "Article IV"
}

export interface ParagraphBlock {
  type: 'paragraph';
  runs: TextRun[];
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

export interface ListItem {
  runs: TextRun[];
  subList?: ListBlock;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}

export interface TableCell {
  runs: TextRun[];
  colSpan?: number;
  rowSpan?: number;
  alignment?: 'left' | 'center' | 'right';
  backgroundColorHex?: string;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableBlock {
  type: 'table';
  caption?: string;
  columnWidthsPercentage?: number[];
  headerRows: TableRow[];
  bodyRows: TableRow[];
}

export interface CalloutBlock {
  type: 'callout';
  intent: 'info' | 'warning' | 'legal_notice';
  runs: TextRun[];
}

export interface PageBreakBlock {
  type: 'page_break';
}

export type DocumentBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | CalloutBlock
  | PageBreakBlock;

export interface DocumentSection {
  id: string;
  title?: string;
  blocks: DocumentBlock[];
}

export interface LegalCitation {
  id: string; // e.g. "cite_1"
  citationType: 'case' | 'statute' | 'regulation' | 'contract_clause';
  formalCitation: string; // e.g. "42 U.S.C. § 1983" or "Brown v. Board of Educ., 347 U.S. 483 (1954)"
  pinCite?: string;
  url?: string;
  footnoteIndex?: number;
}

export interface DocumentMetadata {
  author?: string;
  clientMatterNumber?: string;
  jurisdiction?: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  originalFileName?: string;
  originalFileSha256?: string;
}

export interface DocumentStyling {
  pageSize: 'LETTER' | 'LEGAL' | 'A4';
  orientation: 'portrait' | 'landscape';
  margins: {
    topPt: number; // 72pt = 1 inch
    bottomPt: number;
    leftPt: number;
    rightPt: number;
  };
  typography: {
    fontFamily: string; // e.g. "Calibri", "Times New Roman", "Inter"
    baseFontSizePt: number; // e.g. 11
    lineHeight: number; // e.g. 1.25
  };
  headerFooter: {
    headerTextLeft?: string;
    headerTextRight?: string;
    footerTextLeft?: string;
    footerPageNumbering: 'PAGE_X_OF_Y' | 'PAGE_X' | 'NONE';
    differentFirstPage: boolean;
  };
}

export interface CanonicalDocument {
  id: string;
  title: string;
  version: string; // e.g. "2.0.0"
  revisionId: string;
  metadata: DocumentMetadata;
  styling: DocumentStyling;
  sections: DocumentSection[];
  citations: LegalCitation[];
}
