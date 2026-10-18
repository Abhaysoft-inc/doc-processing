# Enterprise Document Processing & Generation Service (`doc-processing`)

An end-to-end document ingestion, cloud storage, deterministic triage, AI-powered extraction, Canonical AST normalization, and native **DOCX & PDF generation engine** built with **Node.js**, **Express**, **TypeScript**, **AWS S3**, **docx**, **Puppeteer**, **pdfjs-dist**, and **Google Gemini VLM**.

---

## 📋 Table of Contents
- [Architecture & Workflow](#-architecture--workflow)
- [Module Structure](#-module-structure)
- [API Routes Reference](#-api-routes-reference)
  - [`POST /api/documents/process`](#post-apidocumentsprocess)
  - [`POST /api/documents/generate/docx`](#post-apidocumentsgeneratedocx)
  - [`POST /api/documents/generate/pdf`](#post-apidocumentsgeneratepdf)
  - [`POST /api/documents/generate/all`](#post-apidocumentsgenerateall)
  - [`POST /api/documents/presigned-upload`](#post-apidocumentspresigned-upload)
  - [`GET /health`](#get-health)
- [Canonical Document AST Specification](#-canonical-document-ast-specification)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [Quickstart & Testing](#-quickstart--testing)

---

## 🏗️ Architecture & Workflow

The module processes documents through a multi-tier pipeline:

```mermaid
flowchart TD
    Client[Client / Web UI / Core Service] -->|Multipart Upload| UploadGateway[Ingestion Gateway]
    
    subgraph Validation & Storage
        UploadGateway --> MagicBytes[Magic Byte Validation (file-type)]
        MagicBytes --> HashCalc[SHA-256 Checksum Calculation]
        HashCalc --> S3Storage[AWS S3 Cloud Storage]
    end

    subgraph Dual-Route Extraction
        MagicBytes --> TriageRouter{Document Triage}
        TriageRouter -->|Native Digital PDF| DigitalParser[pdfjs-dist Stream Parser]
        TriageRouter -->|DOCX| DocxParser[Mammoth Semantic Parser]
        TriageRouter -->|Scanned PDF / Image| VlmModel[Gemini VLM (model from .env)]
    end

    subgraph Canonical Normalization
        DigitalParser --> CanonicalAST[(Canonical Document AST)]
        DocxParser --> CanonicalAST
        VlmModel --> CanonicalAST
    end

    subgraph Generation Engines
        CanonicalAST --> DocxGen[Native DOCX Engine (docx npm)]
        CanonicalAST --> HtmlRenderer[Semantic HTML / Paged Media]
        HtmlRenderer --> PdfGen[Headless Chrome PDF Engine (Puppeteer)]
    end

    DocxGen --> Download[Downloadable Files & S3 Artifacts]
    PdfGen --> Download
```

---

## 📁 Module Structure

```
doc-processing/
├── public/
│   └── index.html               # Web UI for drag-and-drop document testing & preview
├── src/
│   ├── api/
│   │   ├── document.routes.ts       # Express routes & Multer middleware
│   │   └── document.controller.ts   # Controllers for ingest, export, presigned URLs
│   ├── config/
│   │   └── index.ts                 # Central typed configuration loader for env variables
│   ├── modules/
│   │   ├── canonical/
│   │   │   ├── canonical.types.ts   # Canonical AST TypeScript interfaces
│   │   │   └── canonical.schema.ts  # Zod validation schema & AST factories
│   │   ├── validation/
│   │   │   └── file-validator.ts    # Magic bytes detection & SHA-256 calculation
│   │   ├── extraction/
│   │   │   ├── digital-pdf.service.ts    # Fast deterministic text extraction (pdfjs-dist)
│   │   │   ├── docx-extractor.service.ts # Native DOCX extraction (mammoth)
│   │   │   ├── doc-extractor.service.ts  # Legacy DOC CFBF extraction (word-extractor)
│   │   │   ├── vlm-extractor.service.ts  # Dynamic Gemini VLM extraction
│   │   │   └── triage.service.ts         # Dual-route extraction triage
│   │   ├── generation/
│   │   │   ├── docx-generator.ts    # Native DOCX generation (docx)
│   │   │   ├── html-renderer.ts     # Semantic HTML / CSS Paged Media renderer
│   │   │   └── pdf-generator.ts     # Puppeteer PDF generation with SSRF guards
│   │   └── storage/
│   │       └── s3.service.ts        # AWS S3 buffer upload & presigned URLs
│   ├── types/
│   │   └── mammoth.d.ts             # Ambient TypeScript type declarations
│   └── index.ts                     # Express initialization with 50MB body limit
├── .env                         # Local environment variables
├── .env.example                 # Environment template
└── package.json
```

---

## 🔌 API Routes Reference

### `POST /api/documents/process`
Ingests a document, validates magic bytes and SHA-256 hash, uploads original to S3, deterministically triages, and returns the Canonical Document AST.

- **Content-Type:** `multipart/form-data`
- **Fields:** `file` (Binary)
- **Optional Headers:** `x-file-sha256` (verifies file integrity against client hash)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "jobId": "e1596700-1111-4712-a722-bba39f977c8e",
  "status": "completed",
  "data": {
    "jobId": "e1596700-1111-4712-a722-bba39f977c8e",
    "originalName": "contract.pdf",
    "detectedMimeType": "application/pdf",
    "sizeBytes": 54200,
    "sha256": "f5208f13a19d1af080468791f9be1771ff914bb508c5084f8b49438e5b12f30a",
    "s3Location": "https://bucket.s3.us-east-1.amazonaws.com/uploads/...",
    "routeTaken": "digital_pdf",
    "pageCount": 3,
    "ast": {
      "id": "...",
      "title": "contract",
      "version": "2.0.0",
      "styling": { ... },
      "sections": [ ... ],
      "citations": [ ... ]
    }
  }
}
```

---

### `POST /api/documents/generate/docx`
Generates and downloads a native OpenXML DOCX document directly from a Canonical Document AST.

- **Content-Type:** `application/json`
- **Body:** `{ "ast": CanonicalDocument }`
- **Response:** Binary DOCX file (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)

---

### `POST /api/documents/generate/pdf`
Generates and downloads a pixel-accurate PDF directly from a Canonical Document AST using Chromium Paged Media.

- **Content-Type:** `application/json`
- **Body:** `{ "ast": CanonicalDocument }`
- **Response:** Binary PDF file (`application/pdf`)

---

### `POST /api/documents/generate/all`
Generates both DOCX and PDF, uploads them to AWS S3, and returns presigned download URLs with configurable expiration.

- **Content-Type:** `application/json`
- **Body:** `{ "ast": CanonicalDocument, "docId": "optional-id", "tenantId": "optional-tenant" }`
- **Response:**
```json
{
  "success": true,
  "data": {
    "title": "Agreement",
    "docx": {
      "s3Location": "https://...",
      "downloadUrl": "https://...presigned..."
    },
    "pdf": {
      "s3Location": "https://...",
      "downloadUrl": "https://...presigned..."
    }
  }
}
```

---

### `POST /api/documents/presigned-upload`
Generates a presigned S3 upload URL allowing direct browser-to-S3 uploads without proxying large files through the Node.js API.

---

### `GET /health`
Liveness probe returning server status, configured Gemini model, and S3 bucket.

---

## 🔒 Configuration & Environment Variables

No secrets, keys, endpoints, or model names are hardcoded in the application. All values are fetched strictly from `.env`:

```ini
PORT=3000
MAX_FILE_SIZE_MB=20

# Google Gemini Studio API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash

# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_S3_BUCKET_NAME=your_s3_bucket_name
```

---

## 🚀 Quickstart & Testing

### 1. Build and Run Dev Server
```powershell
npm run dev
```
Open `http://localhost:3000` to access the drag-and-drop web client.

### 2. Type Check & Production Build
```powershell
# Type check TypeScript codebase
npx tsc --noEmit

# Compile to dist/
npm run build
```
