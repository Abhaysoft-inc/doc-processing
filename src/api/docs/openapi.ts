import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { canonicalDocumentSchema } from '../../modules/canonical/canonical.schema.js';
import { config } from '../../config/index.js';

// Ensure Zod is extended with OpenAPI helpers
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ==========================================
// 1. Shared Schemas & Component Registration
// ==========================================

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({
        description: 'Machine-readable application error code',
        example: 'FILE_TOO_LARGE',
      }),
      message: z.string().openapi({
        description: 'Human-readable explanation of the error',
        example: 'Uploaded file exceeds the maximum allowed size limit.',
      }),
      requestId: z.string().openapi({
        description: 'Unique correlation ID for tracing across request lifecycle and logs',
        example: 'd8e4ef9a-41d7-498b-a481-9f2dcadbf3e1',
      }),
    }),
  })
  .openapi('ErrorResponse');

export const healthResponseSchema = z
  .object({
    status: z.string().openapi({ example: 'ok' }),
    environment: z.string().openapi({ example: 'development' }),
    isProduction: z.boolean().openapi({ example: false }),
    timestamp: z.string().openapi({ example: '2026-10-18T14:30:00.000Z' }),
  })
  .openapi('HealthResponse');

export const processDocumentRequestSchema = z
  .object({
    file: z.instanceof(Object).openapi({
      type: 'string',
      format: 'binary',
      description: 'Document file buffer (PDF, DOCX, DOC, PNG, JPEG, TIFF, WebP)',
    }),
  })
  .openapi('ProcessDocumentRequest');

export const processHeadersSchema = z.object({
  'x-file-sha256': z.string().optional().openapi({
    description: 'Optional expected SHA-256 hex digest of the file for integrity validation',
  }),
});

export const processDocumentResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    jobId: z.string().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    status: z.string().openapi({ example: 'completed' }),
    message: z.string().openapi({ example: 'Document successfully processed and canonicalized.' }),
    data: z.object({
      jobId: z.string().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
      originalName: z.string().openapi({ example: 'commercial-lease.pdf' }),
      detectedMimeType: z.string().openapi({ example: 'application/pdf' }),
      sizeBytes: z.number().openapi({ example: 245120 }),
      sha256: z.string().openapi({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }),
      s3Location: z.string().openapi({ example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/default/docs/commercial-lease.pdf' }),
      s3Key: z.string().openapi({ example: 'orgs/default/docs/commercial-lease.pdf' }),
      routeTaken: z.enum(['digital_pdf', 'digital_docx', 'digital_doc', 'vlm_ocr']).openapi({ example: 'digital_pdf' }),
      pageCount: z.number().openapi({ example: 4 }),
      ast: canonicalDocumentSchema,
      processedAt: z.string().openapi({ example: '2026-10-18T14:30:00.000Z' }),
    }),
  })
  .openapi('ProcessDocumentResponse');

export const generateDocxRequestSchema = z
  .union([
    canonicalDocumentSchema,
    z.object({
      ast: canonicalDocumentSchema,
    }),
  ])
  .openapi('GenerateDocxRequest');

export const generatePdfRequestSchema = z
  .union([
    canonicalDocumentSchema,
    z.object({
      ast: canonicalDocumentSchema,
    }),
  ])
  .openapi('GeneratePdfRequest');

export const generateAllRequestSchema = z
  .object({
    ast: canonicalDocumentSchema,
    docId: z.string().optional().openapi({
      description: 'Optional document ID identifier (defaults to a new UUID)',
      example: 'doc-89210-lease',
    }),
    tenantId: z.string().optional().openapi({
      description: 'Optional tenant workspace namespace (defaults to "default")',
      example: 'enterprise-client-12',
    }),
  })
  .openapi('GenerateAllRequest');

export const generateAllResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Both DOCX and PDF documents generated and stored successfully.' }),
    data: z.object({
      docId: z.string().openapi({ example: 'doc-89210-lease' }),
      title: z.string().openapi({ example: 'Commercial Lease Agreement' }),
      docx: z.object({
        s3Location: z.string().openapi({ example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/enterprise-client-12/docs/doc-89210-lease/Commercial_Lease.docx' }),
        downloadUrl: z.string().openapi({ example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/enterprise-client-12/docs/doc-89210-lease/Commercial_Lease.docx?X-Amz-Signature=...' }),
        sizeBytes: z.number().openapi({ example: 45210 }),
      }),
      pdf: z.object({
        s3Location: z.string().openapi({ example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/enterprise-client-12/docs/doc-89210-lease/Commercial_Lease.pdf' }),
        downloadUrl: z.string().openapi({ example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/enterprise-client-12/docs/doc-89210-lease/Commercial_Lease.pdf?X-Amz-Signature=...' }),
        sizeBytes: z.number().openapi({ example: 89430 }),
      }),
    }),
  })
  .openapi('GenerateAllResponse');

export const presignedUploadRequestSchema = z
  .object({
    filename: z.string().openapi({
      description: 'File name including extension',
      example: 'quarterly-audit.pdf',
    }),
    contentType: z.string().openapi({
      description: 'MIME type of the target file',
      example: 'application/pdf',
    }),
    tenantId: z.string().optional().openapi({
      description: 'Tenant organization partition key (defaults to "default")',
      example: 'tenant-legal-ops',
    }),
    docId: z.string().optional().openapi({
      description: 'Pre-assigned document ID (defaults to a generated UUID)',
      example: 'doc-audit-2026-q3',
    }),
  })
  .openapi('PresignedUploadRequest');

export const presignedUploadResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    data: z.object({
      uploadUrl: z.string().openapi({
        description: 'Secure S3 presigned PUT URL valid for 15 minutes',
        example: 'https://doc-processing-bucket.s3.amazonaws.com/orgs/tenant-legal-ops/docs/doc-audit-2026-q3/1700000000000-quarterly-audit.pdf?X-Amz-Signature=...',
      }),
      key: z.string().openapi({
        description: 'S3 key where file will reside upon PUT completion',
        example: 'orgs/tenant-legal-ops/docs/doc-audit-2026-q3/1700000000000-quarterly-audit.pdf',
      }),
    }),
  })
export const processDocumentAsyncRequestSchema = z
  .object({
    s3Key: z.string().openapi({
      description: 'S3 object key where the uploaded binary is stored',
      example: 'orgs/default/docs/550e8400-e29b-41d4-a716-446655440000/1729272000000-contract.pdf',
    }),
    originalName: z.string().openapi({
      description: 'Original filename with extension',
      example: 'contract.pdf',
    }),
    mimeType: z.string().openapi({
      description: 'MIME type of the file',
      example: 'application/pdf',
    }),
    tenantId: z.string().optional().openapi({
      description: 'Optional tenant identifier for multi-tenant isolation',
      example: 'default',
    }),
    userId: z.string().optional().openapi({
      description: 'Optional user identifier',
      example: 'user-123',
    }),
  })
  .openapi('ProcessDocumentAsyncRequest');

export const processDocumentAsyncResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    jobId: z.string().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    status: z.string().openapi({ example: 'queued' }),
    message: z.string().openapi({ example: 'Document job accepted and enqueued for background processing.' }),
    data: z.object({
      jobId: z.string().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
      status: z.string().openapi({ example: 'queued' }),
      statusUrl: z.string().openapi({ example: '/api/documents/jobs/3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    }),
  })
  .openapi('ProcessDocumentAsyncResponse');

export const jobStatusResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    data: z.object({
      jobId: z.string().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
      status: z.string().openapi({ example: 'completed' }),
      progress: z.number().openapi({ example: 100 }),
      result: z
        .object({
          jobId: z.string(),
          documentId: z.string(),
          status: z.string(),
          s3AstKey: z.string().optional(),
          s3AstUrl: z.string().optional(),
          pageCount: z.number().optional(),
          durationMs: z.number().optional(),
        })
        .optional(),
      error: z.string().optional(),
      failedReason: z.string().optional(),
      createdAt: z.number().optional(),
      processedOn: z.number().optional(),
      finishedOn: z.number().optional(),
    }),
  })
  .openapi('JobStatusResponse');

// Register Schemas into Components
registry.register('CanonicalDocument', canonicalDocumentSchema);
registry.register('ErrorResponse', errorResponseSchema);
registry.register('HealthResponse', healthResponseSchema);
registry.register('ProcessDocumentResponse', processDocumentResponseSchema);
registry.register('ProcessDocumentAsyncRequest', processDocumentAsyncRequestSchema);
registry.register('ProcessDocumentAsyncResponse', processDocumentAsyncResponseSchema);
registry.register('JobStatusResponse', jobStatusResponseSchema);
registry.register('GenerateAllRequest', generateAllRequestSchema);
registry.register('GenerateAllResponse', generateAllResponseSchema);
registry.register('PresignedUploadRequest', presignedUploadRequestSchema);
registry.register('PresignedUploadResponse', presignedUploadResponseSchema);


// ==========================================
// 2. Route Registration
// ==========================================

// Health: GET /healthz
registry.registerPath({
  method: 'get',
  path: '/healthz',
  summary: 'Liveness / Readiness Probe',
  description: 'Lightweight health probe for container orchestrators (Kubernetes, AWS ECS) returning raw 200 OK.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is healthy and able to accept traffic',
      content: {
        'text/plain': {
          schema: z.string().openapi({ example: 'OK' }),
        },
      },
    },
  },
});

// Health: GET /health
registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Detailed Health & Diagnostic Status',
  description: 'Provides structured diagnostic information including environment mode, timestamp, and active limits.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service health details',
      content: {
        'application/json': {
          schema: healthResponseSchema,
        },
      },
    },
  },
});

// Documents: POST /api/documents/process
registry.registerPath({
  method: 'post',
  path: '/api/documents/process',
  summary: 'Ingest, Triage & Extract Document into Canonical AST',
  description: `Accepts multipart file upload of documents (Digital PDF, Scanned PDF, Word DOCX/DOC, Images).
1. Validates magic bytes and file integrity against optional SHA-256 header.
2. Uploads the pristine original to AWS S3.
3. Automatically triages to the optimal extraction pipeline (Digital parser vs. Mammoth DOCX vs. Gemini Multimodal VLM).
4. Normalizes layout, tables, styles, citations, and headings into the Canonical Document AST format.`,
  tags: ['Documents'],
  request: {
    headers: processHeadersSchema,
    body: {
      description: 'Multipart form-data payload containing the binary document file under the "file" field',
      content: {
        'multipart/form-data': {
          schema: processDocumentRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Document successfully ingested, parsed, and converted to Canonical AST',
      content: {
        'application/json': {
          schema: processDocumentResponseSchema,
        },
      },
    },
    400: {
      description: 'No file provided or invalid request form',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    413: {
      description: 'File size exceeds maximum allowed configured limit',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    415: {
      description: 'Unsupported file format or MIME type mismatch with magic bytes',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    422: {
      description: 'Corrupt, encrypted, or password-protected document that cannot be processed',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'Server or extraction failure during processing pipeline',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Documents: POST /api/documents/process-async
registry.registerPath({
  method: 'post',
  path: '/api/documents/process-async',
  summary: 'Async Document Processing Ingestion',
  description: `High-concurrency document processing ingestion:
1. Accepts S3 object key, original filename, and MIME type of an already uploaded file.
2. Enqueues a processing job into BullMQ backed by Redis in < 20ms.
3. Returns 202 Accepted with a unique jobId and polling URL immediately.
4. Background workers pull jobs, download buffers from S3, extract AST, and save results back to S3.`,
  tags: ['Documents'],
  request: {
    body: {
      description: 'Document reference payload with S3 key and metadata',
      content: {
        'application/json': {
          schema: processDocumentAsyncRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    202: {
      description: 'Document job accepted and queued for asynchronous processing',
      content: {
        'application/json': {
          schema: processDocumentAsyncResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing required parameters (s3Key, originalName, or mimeType)',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'Queue or Redis scheduling failure',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Documents: GET /api/documents/jobs/{jobId}
registry.registerPath({
  method: 'get',
  path: '/api/documents/jobs/{jobId}',
  summary: 'Get Document Processing Job Status',
  description: 'Polls the live status, progress, and result/error of an asynchronous document processing job.',
  tags: ['Documents'],
  request: {
    params: z.object({
      jobId: z.string().openapi({
        description: 'Unique background job identifier returned upon enqueueing',
        example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Current job status, progress, and results (if completed)',
      content: {
        'application/json': {
          schema: jobStatusResponseSchema,
        },
      },
    },
    404: {
      description: 'Job with specified ID not found in queue',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server or Redis retrieval error',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Documents: POST /api/documents/generate/docx
registry.registerPath({
  method: 'post',
  path: '/api/documents/generate/docx',

  summary: 'Generate Native DOCX File',
  description: 'Renders and downloads a Microsoft Word (.docx) binary document directly from a Canonical Document AST.',
  tags: ['Generation'],
  request: {
    body: {
      description: 'Canonical Document AST payload (either direct or under the "ast" property)',
      content: {
        'application/json': {
          schema: generateDocxRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Native DOCX document binary attachment',
      content: {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
    400: {
      description: 'Invalid or missing document AST',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'DOCX compilation or generation failure',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Documents: POST /api/documents/generate/pdf
registry.registerPath({
  method: 'post',
  path: '/api/documents/generate/pdf',
  summary: 'Generate Pixel-Perfect PDF File',
  description: 'Renders and downloads a publication-grade PDF file directly from a Canonical Document AST via headless Chromium.',
  tags: ['Generation'],
  request: {
    body: {
      description: 'Canonical Document AST payload (either direct or under the "ast" property)',
      content: {
        'application/json': {
          schema: generatePdfRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Pixel-perfect PDF binary file attachment',
      content: {
        'application/pdf': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
    400: {
      description: 'Invalid or missing document AST',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'PDF rendering or browser print failure',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Documents: POST /api/documents/generate/all
registry.registerPath({
  method: 'post',
  path: '/api/documents/generate/all',
  summary: 'Generate Both DOCX & PDF with S3 Storage',
  description: 'Concurrently renders both DOCX and PDF formats from a Canonical Document AST, stores them in AWS S3, and returns presigned download URLs.',
  tags: ['Generation'],
  request: {
    body: {
      description: 'Canonical Document AST payload with optional docId and tenantId identifiers',
      content: {
        'application/json': {
          schema: generateAllRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Both DOCX and PDF documents generated, uploaded to S3, and presigned download URLs returned',
      content: {
        'application/json': {
          schema: generateAllResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid or missing document AST',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'Concurrent generation or S3 upload failure',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Storage: POST /api/documents/presigned-upload
registry.registerPath({
  method: 'post',
  path: '/api/documents/presigned-upload',
  summary: 'Generate Direct S3 Presigned Upload URL',
  description: 'Creates a short-lived presigned AWS S3 PUT URL allowing direct browser-to-S3 file uploads without routing multi-gigabyte payloads through the application server.',
  tags: ['Storage'],
  request: {
    body: {
      description: 'Target filename, MIME content type, and optional tenancy parameters',
      content: {
        'application/json': {
          schema: presignedUploadRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Presigned upload URL and S3 storage key created successfully',
      content: {
        'application/json': {
          schema: presignedUploadResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing required parameters "filename" or "contentType"',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: 'AWS S3 credential or presigning failure',
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// ==========================================
// 3. Document Generator
// ==========================================

export function createOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Document Processing Service API',
      version: '1.0.0',
      description: `Production-grade microservice for legal and enterprise document processing.

### Key Capabilities
- **Multi-Format Ingestion**: Ingests Digital PDF, Scanned PDF, Microsoft Word (.docx / .doc), and Images.
- **Intelligent Triaging**: Automatically selects between high-speed native parsers and Google Gemini Multimodal VLM based on document complexity.
- **Canonical AST Normalization**: Normalized Abstract Syntax Tree preserving headings, typography, tables, callouts, and citations.
- **High-Fidelity Generation**: Generates native Microsoft Word (.docx) and pixel-perfect Chromium-rendered PDF.
- **Cloud Integration**: AWS S3 storage with presigned direct-upload and download workflows.
- **Observability**: Structured JSON logging (Pino), AsyncLocalStorage correlation tracing, and RFC 7807-style error responses.`,
      contact: {
        name: 'Document Processing Engineering Team',
      },
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: `Local development server (${config.env})`,
      },
    ],
    tags: [
      { name: 'Health', description: 'Liveness probes and diagnostic status' },
      { name: 'Documents', description: 'Document ingestion, validation, and canonical extraction' },
      { name: 'Generation', description: 'Document compilation into native DOCX and PDF formats' },
      { name: 'Storage', description: 'AWS S3 presigned direct-upload capabilities' },
    ],
  });
}

export const openApiDocument = createOpenApiDocument();
