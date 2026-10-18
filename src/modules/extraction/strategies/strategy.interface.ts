import { ValidatedFile } from '../../validation/file-validator.js';
import { CanonicalDocument } from '../../canonical/canonical.types.js';

export type ExtractionRoute = 'digital_docx' | 'digital_doc' | 'digital_pdf' | 'vlm_ocr';

export interface StrategyExtractionResult {
  ast: CanonicalDocument;
  routeTaken: ExtractionRoute;
  pageCount?: number;
}

export interface ExtractorStrategy {
  readonly supportedMimes: ReadonlySet<string>;
  extract(file: ValidatedFile): Promise<StrategyExtractionResult>;
}
