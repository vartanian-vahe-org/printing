/**
 * Browser-only PDF helpers built on pdf.js. pdf.js is loaded on demand, the first time a
 * customer uploads a file, so it does not weigh on the initial page load.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSize } from './pdf-checks';

type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    return lib;
  });
  return pdfjs;
}

export class PdfReadError extends Error {}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  pageCount: number;
  /** Sizes (points, rotation applied) of the first two pages, the only ones we use. */
  pages: PageSize[];
}

export async function openPdf(file: File): Promise<OpenedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(data.subarray(0, 5));
  if (header !== '%PDF-') throw new PdfReadError('This file is not a valid PDF.');

  const lib = await loadPdfJs();
  let doc: PDFDocumentProxy;
  try {
    doc = await lib.getDocument({ data }).promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    throw new PdfReadError(
      name === 'PasswordException' ? 'This PDF is password protected. Please upload an unlocked file.' : 'This PDF could not be opened.',
    );
  }

  const pages: PageSize[] = [];
  for (let i = 1; i <= Math.min(2, doc.numPages); i++) {
    const viewport = (await doc.getPage(i)).getViewport({ scale: 1 });
    pages.push({ widthPt: viewport.width, heightPt: viewport.height });
  }
  return { doc, pageCount: doc.numPages, pages };
}

/**
 * Renders one page to a PNG object URL at print-like resolution, trimming `cropPt` from every
 * side (the bleed) so the image matches the finished card. Caller revokes the URL.
 */
export async function renderPageImage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  cropPt: number,
  pxPerInch = 200,
): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: pxPerInch / 72 });
  const full = document.createElement('canvas');
  full.width = Math.round(viewport.width);
  full.height = Math.round(viewport.height);
  const fullContext = full.getContext('2d');
  if (!fullContext) throw new PdfReadError('Canvas is not available');
  await page.render({ canvas: full, canvasContext: fullContext, viewport }).promise;

  const crop = Math.round((cropPt * pxPerInch) / 72);
  const out = document.createElement('canvas');
  out.width = Math.max(1, full.width - 2 * crop);
  out.height = Math.max(1, full.height - 2 * crop);
  out.getContext('2d')!.drawImage(full, crop, crop, out.width, out.height, 0, 0, out.width, out.height);

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) throw new PdfReadError('Could not render this page');
  return URL.createObjectURL(blob);
}
