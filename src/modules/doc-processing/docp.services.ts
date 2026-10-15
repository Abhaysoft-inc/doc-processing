import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import { config } from '../../config/index.js';

export interface ProcessedDocumentResult {
  jobId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  s3Location: string;
  extractedInfo: string;
  extractedAt: string;
}

/**
 * Uploads document buffer directly to AWS S3. Throws error if AWS is not configured or upload fails.
 */
export async function uploadToS3(file: Express.Multer.File, jobId: string): Promise<string> {
  const { region, accessKeyId, secretAccessKey, bucketName } = config.aws;

  if (!bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS credentials or S3 bucket name are missing. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET_NAME in your .env file.'
    );
  }

  const key = `uploads/${jobId}-${Date.now()}-${file.originalname}`;

  try {
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(command);
    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    console.log(`[S3] Successfully uploaded file to ${s3Url}`);
    return s3Url;
  } catch (error) {
    console.error('[S3] Error uploading file to S3:', error);
    throw new Error(`Failed to upload to S3: ${(error as Error).message}`);
  }
}

/**
 * Extracts text and structured information using Google Studio VLM (Gemini).
 * Throws error if GEMINI_API_KEY is not configured or if extraction fails.
 */
export async function extractWithVLM(file: Express.Multer.File): Promise<string> {
  if (!config.gemini.apiKey) {
    throw new Error(
      'Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file.'
    );
  }

  const isDocx =
    file.mimetype.includes('wordprocessingml') ||
    file.mimetype.includes('msword') ||
    file.originalname.toLowerCase().endsWith('.docx') ||
    file.originalname.toLowerCase().endsWith('.doc');

  let rawDocxText = '';
  if (isDocx) {
    try {
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      rawDocxText = parsed.value;
    } catch (docxErr) {
      console.error('[Mammoth] Failed to extract text from DOCX:', docxErr);
      throw new Error(`Failed to read DOCX file: ${(docxErr as Error).message}`);
    }
  }

  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  const prompt = `You are a document analysis and extraction specialist. 
Carefully analyze the provided document.
Extract and return:
1. Document Title & Category/Type
2. High-level Summary
3. Key Information (dates, names, organizations, amounts, references, IDs)
4. Full Text Content / Transcription
5. Any Key-Value Pairs or Tabular Data detected

Format your response cleanly with clear section headings.`;

  try {
    if (isDocx) {
      const interaction = await ai.interactions.create({
        model: config.gemini.model,
        input: [
          {
            type: 'text',
            text: `${prompt}\n\nHere is the raw text extracted from the DOCX document:\n\n${rawDocxText || '[Empty document content]'}`,
          },
        ],
      });
      return interaction.output_text || 'No text extracted from document.';
    }

    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const interaction = await ai.interactions.create({
        model: config.gemini.model,
        input: [
          { type: 'text', text: prompt },
          {
            type: 'document',
            mime_type: 'application/pdf',
            data: file.buffer.toString('base64'),
          },
        ],
      });
      return interaction.output_text || 'No text extracted from document.';
    }

    // Default to image content for supported image types
    const interaction = await ai.interactions.create({
      model: config.gemini.model,
      input: [
        { type: 'text', text: prompt },
        {
          type: 'image',
          mime_type: file.mimetype,
          data: file.buffer.toString('base64'),
        },
      ],
    });

    return interaction.output_text || 'No text extracted from document.';
  } catch (error) {
    console.error('[Gemini] Error calling Gemini VLM:', error);
    throw new Error(`Google VLM extraction failed: ${(error as Error).message}`);
  }
}

/**
 * Logs extracted document info to the console.
 */
export function logDocumentResult(result: ProcessedDocumentResult): void {
  const separator = '='.repeat(80);
  const formattedContent = `
${separator}
JOB ID: ${result.jobId}
TIMESTAMP: ${result.extractedAt}
FILE NAME: ${result.originalName}
MIME TYPE: ${result.mimeType}
SIZE: ${(result.sizeBytes / 1024).toFixed(2)} KB
S3 LOCATION: ${result.s3Location}
${'-'.repeat(80)}
EXTRACTED INFO:
${result.extractedInfo}
${separator}
`;

  console.log(formattedContent);
}
