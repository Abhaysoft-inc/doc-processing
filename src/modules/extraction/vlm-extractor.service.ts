import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import {
  CanonicalDocument,
  DocumentBlock,
} from '../canonical/canonical.types.js';
import { createDefaultCanonicalDocument } from '../canonical/canonical.schema.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

interface RawVlmOutput {
  title?: string;
  summary?: string;
  sections?: Array<{
    title?: string;
    blocks?: Array<{
      type: 'heading' | 'paragraph' | 'table';
      level?: number;
      text?: string;
      headers?: string[];
      rows?: string[][];
    }>;
  }>;
  citations?: Array<{
    citationType?: 'case' | 'statute' | 'regulation' | 'contract_clause';
    formalCitation: string;
    pinCite?: string;
  }>;
}

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const status =
    (err as { status?: number; statusCode?: number }).status ||
    (err as { status?: number; statusCode?: number }).statusCode;

  if (status) {
    if (status === 429) return true; // Rate limit / Quota exceeded
    if (status >= 500 && status < 600) return true; // Server errors
    if (status >= 400 && status < 500) return false; // 4xx client errors -> NEVER retry
  }

  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('overloaded') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit')
  );
}

/**
 * Extracts text and structured layout from scanned PDFs or images using Google Gemini VLM.
 * Retries transient failures up to 3 times with exponential backoff and AbortSignal.timeout().
 */
export async function extractWithVlm(
  fileBuffer: Buffer,
  mimeType: string,
  originalFileName: string
): Promise<CanonicalDocument> {
  const startHr = process.hrtime.bigint();
  const documentId = crypto.randomUUID();

  if (!config.gemini.apiKey) {
    throw new AppError(
      'CONFIG_ERROR',
      'GEMINI_API_KEY is not configured in .env. Please configure GEMINI_API_KEY to enable VLM extraction.',
      500,
      false
    );
  }

  if (!config.gemini.model) {
    throw new AppError(
      'CONFIG_ERROR',
      'GEMINI_MODEL is not configured in .env. Please configure GEMINI_MODEL (e.g. gemini-3.8-flash) in .env.',
      500,
      false
    );
  }

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const prompt = `You are a high-accuracy document extraction specialist.
Analyze this document thoroughly and extract its complete content and structure.
Respond with pure JSON conforming to this schema:
{
  "title": "Document Title",
  "summary": "Executive summary",
  "sections": [
    {
      "title": "Section Title",
      "blocks": [
        { "type": "heading", "level": 1, "text": "Section Heading" },
        { "type": "paragraph", "text": "Paragraph content verbatim" },
        { "type": "table", "headers": ["Column 1", "Column 2"], "rows": [["Cell 1", "Cell 2"]] }
      ]
    }
  ],
  "citations": [
    { "citationType": "case", "formalCitation": "Citation text", "pinCite": "pinpoint cite" }
  ]
}
Return only valid, parseable JSON without commentary.`;

  const isPdf =
    mimeType === 'application/pdf' ||
    originalFileName.toLowerCase().endsWith('.pdf');

  const base64Data = fileBuffer.toString('base64');

  const inputItem = isPdf
    ? {
        type: 'document' as const,
        mime_type: 'application/pdf',
        data: base64Data,
      }
    : {
        type: 'image' as const,
        mime_type: mimeType,
        data: base64Data,
      };

  let rawOutput = '';
  let lastError: unknown = null;
  const RETRY_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = AbortSignal.timeout(60000); // 60s timeout per call

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('VLM request timed out after 60s'));
        });
      });

      const interactionPromise = ai.interactions.create({
        model: config.gemini.model,
        input: [
          { type: 'text', text: prompt },
          inputItem,
        ],
      });

      const interaction = (await Promise.race([
        interactionPromise,
        timeoutPromise,
      ])) as { output_text?: string };

      rawOutput = interaction.output_text || '';
      lastError = null;
      break; // Successful completion
    } catch (err: unknown) {
      lastError = err;
      const isTransient = isTransientError(err);

      if (attempt === 1 && isTransient) {
        log().warn(
          {
            documentId,
            attempt,
            error: err instanceof Error ? err.message : String(err),
          },
          'Transient VLM failure encountered, retrying once after fixed delay'
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      // Non-transient error or exhausted retries
      break;
    }
  }

  if (lastError || !rawOutput) {
    throw (lastError instanceof Error ? lastError : new Error(String(lastError || 'Empty VLM output')));
  }

  // Parse JSON from output
  let parsed: RawVlmOutput | null = null;
  try {
    const cleaned = rawOutput
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    parsed = JSON.parse(cleaned) as RawVlmOutput;
  } catch {
    log().warn({ documentId, stage: 'vlm_json_parse' }, 'VLM response was not pure JSON, falling back to line extraction');
  }

  const fallbackTitle = originalFileName.replace(/\.[^/.]+$/, '');
  const ast = createDefaultCanonicalDocument(
    parsed?.title || fallbackTitle,
    originalFileName
  );
  ast.id = documentId;

  if (parsed?.sections && parsed.sections.length > 0) {
    ast.sections = parsed.sections.map((sec) => ({
      id: crypto.randomUUID(),
      title: sec.title,
      blocks: (sec.blocks || []).map((b): DocumentBlock => {
        if (b.type === 'heading') {
          return {
            type: 'heading',
            level: (b.level as 1 | 2 | 3 | 4 | 5 | 6) || 2,
            text: b.text || '',
          };
        }
        if (b.type === 'table') {
          return {
            type: 'table',
            headerRows: [
              {
                cells: (b.headers || []).map((h) => ({
                  runs: [{ text: h, bold: true }],
                })),
              },
            ],
            bodyRows: (b.rows || []).map((row) => ({
              cells: row.map((cell) => ({
                runs: [{ text: cell }],
              })),
            })),
          };
        }
        return {
          type: 'paragraph',
          runs: [{ text: b.text || '' }],
        };
      }),
    }));
  } else {
    // If output is raw text, convert paragraphs
    const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);
    const blocks: DocumentBlock[] = lines.map((line) => {
      if (line.startsWith('#')) {
        const level = Math.min(6, line.match(/^#+/)?.[0].length || 1) as 1 | 2 | 3 | 4 | 5 | 6;
        return {
          type: 'heading',
          level,
          text: line.replace(/^#+\s*/, ''),
        };
      }
      return {
        type: 'paragraph',
        runs: [{ text: line }],
      };
    });

    ast.sections = [
      {
        id: crypto.randomUUID(),
        blocks,
      },
    ];
  }

  if (parsed?.citations) {
    ast.citations = parsed.citations.map((c, i) => ({
      id: `cite_${i + 1}`,
      citationType: c.citationType || 'case',
      formalCitation: c.formalCitation,
      pinCite: c.pinCite,
      footnoteIndex: i + 1,
    }));
  }

  return ast;
}
