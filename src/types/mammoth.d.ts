declare module 'mammoth' {
  export interface Result {
    value: string;
    messages: any[];
  }

  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<Result>;
  export function convertToHtml(input: { buffer: Buffer } | { path: string }): Promise<Result>;
  export function convertToMarkdown(input: { buffer: Buffer } | { path: string }): Promise<Result>;
}
