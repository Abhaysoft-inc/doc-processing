import puppeteer, { Browser, Page } from 'puppeteer';
import { CanonicalDocument } from '../canonical/canonical.types.js';
import { renderCanonicalToHtml } from './html-renderer.js';
import { log } from '../../shared/context.js';
import { startTimer } from '../../shared/timer.js';

let browserInstance: Browser | null = null;
let renderCount = 0;
let activeRenders = 0;
const MAX_RENDERS_PER_BROWSER = 200;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    renderCount = 0;
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    const browserToClose = browserInstance;
    browserInstance = null;
    renderCount = 0;
    try {
      await browserToClose.close();
    } catch {
      // Ignore closing errors
    }
  }
}

process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);

export async function generatePdfBuffer(doc: CanonicalDocument): Promise<Buffer> {
  const stopTimer = startTimer();
  activeRenders++;
  renderCount++;

  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // SSRF Security: Intercept requests to block internal IPs and arbitrary external fetches
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url().toLowerCase();
      // Block requests targeting AWS/GCP metadata endpoints or internal localhost
      if (
        url.includes('169.254.169.254') ||
        url.includes('localhost') ||
        url.includes('127.0.0.1') ||
        url.includes('0.0.0.0') ||
        url.startsWith('file://')
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const htmlContent = renderCanonicalToHtml(doc);
    await page.setContent(htmlContent, { waitUntil: 'load' });

    const headerText = doc.styling.headerFooter.headerTextRight || doc.title || '';
    const footerText = doc.styling.headerFooter.footerTextLeft || 'CONFIDENTIAL';

    const headerTemplate = `
      <div style="font-size: 8pt; color: #888888; width: 100%; text-align: right; padding-right: 0.75in; font-family: sans-serif;">
        <span>${escapeHtml(headerText)}</span>
      </div>
    `;

    const footerTemplate = `
      <div style="font-size: 8pt; color: #888888; width: 100%; display: flex; justify-content: space-between; padding-left: 0.75in; padding-right: 0.75in; font-family: sans-serif;">
        <span>${escapeHtml(footerText)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;

    const pdfUint8Array = await page.pdf({
      format: (doc.styling.pageSize.toLowerCase() as any) || 'letter',
      landscape: doc.styling.orientation === 'landscape',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: `${(((doc.styling.margins?.topPt ?? 72) + 20) / 72).toFixed(3)}in`,
        bottom: `${(((doc.styling.margins?.bottomPt ?? 72) + 20) / 72).toFixed(3)}in`,
        left: `${((doc.styling.margins?.leftPt ?? 72) / 72).toFixed(3)}in`,
        right: `${((doc.styling.margins?.rightPt ?? 72) / 72).toFixed(3)}in`,
      },
    });

    const buffer = Buffer.from(pdfUint8Array);
    const durationMs = stopTimer();

    // One INFO summary per generated document
    log().info(
      {
        documentId: doc.id,
        format: 'pdf',
        durationMs,
        outputSizeBytes: buffer.length,
        outcome: 'success',
      },
      'Document generation completed'
    );

    return buffer;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore page closing error
      }
    }
    activeRenders--;

    // Recycle Chromium if max renders exceeded to prevent memory bloat
    if (renderCount >= MAX_RENDERS_PER_BROWSER) {
      if (activeRenders === 0) {
        log().info(
          { renderCount, maxRenders: MAX_RENDERS_PER_BROWSER },
          'Recycling Chromium browser process (active renders: 0)'
        );
        await closeBrowser();
      } else if (browserInstance) {
        log().info(
          { renderCount, activeRenders, maxRenders: MAX_RENDERS_PER_BROWSER },
          'Detaching Chromium browser for recycling after in-flight renders complete'
        );
        const oldBrowser = browserInstance;
        browserInstance = null;
        renderCount = 0;
        setTimeout(async () => {
          try {
            await oldBrowser.close();
          } catch {
            // Ignore closing errors
          }
        }, 10000).unref();
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
