'use client';

/**
 * State for "Upload your design": the front file, an optional back file, the upload, the server
 * file check (which turns PDF, AI, TIFF, JPG and PSD files into the print PDF and checks resolution,
 * CMYK colors, fonts and size) and the page images shown on the 3D card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BackMode } from './card3d';
import { checkFile, checkPages, checkPageSize, type CheckResult, type ExpectedSize } from './pdf-checks';
import { openPdf, PdfReadError, renderPageImage, type OpenedPdf } from './pdf-render';
import { checkArtwork, uploadArtwork, type ArtworkCheckRequest } from './upload';

export type FileSide = 'front' | 'back';

export interface PdfFileState {
  id: number;
  fileName: string;
  sizeBytes: number;
  /** uploading → checking (on our server) → ready; error when the file cannot be used at all. */
  status: 'uploading' | 'checking' | 'ready' | 'error';
  /** Why the upload or check did not run (the check's own findings are in `issues`). */
  error?: string;
  /** The file as uploaded, checked again when the card size changes. */
  sourceKey?: string;
  /** What the last check was for: card size, side and pages. */
  checkedFor?: string;
  /** Findings of the server check. */
  issues: CheckResult[];
  /** Pages of the file as uploaded (right away for a PDF or AI file, else after the first check). */
  sourcePageCount?: number;
  /** A PDF or AI file as picked, opened in the browser for page thumbnails before it is even uploaded. */
  source?: OpenedPdf;
  /** The customer's pick of pages from a multi-page file: [front, back] or [front], 1-based. Unset: the first pages. */
  pages?: number[];
  /** The print PDF made by the check: opened for the preview; its key goes in the cart. */
  pdf?: OpenedPdf;
  key?: string;
}

type Files = Partial<Record<FileSide, PdfFileState>>;

let nextId = 1;

/** Frees the pdf.js documents of a file that is replaced or removed. */
function release(file: PdfFileState | undefined) {
  void file?.pdf?.doc.destroy();
  void file?.source?.doc.destroy();
}

export function usePdfFiles() {
  const [files, setFiles] = useState<Files>({});
  const filesRef = useRef(files);
  filesRef.current = files;

  const update = useCallback((side: FileSide, id: number, patch: Partial<PdfFileState>) => {
    setFiles((current) => {
      const file = current[side];
      // Ignore results for a file that has since been replaced or removed.
      if (!file || file.id !== id) return current;
      return { ...current, [side]: { ...file, ...patch } };
    });
  }, []);

  const removeFile = useCallback((side: FileSide) => {
    release(filesRef.current[side]);
    setFiles((current) => {
      const next = { ...current };
      delete next[side];
      return next;
    });
  }, []);

  /** Uploads the file; useArtworkChecks then checks it for the chosen card. */
  const addFile = useCallback(
    async (side: FileSide, file: File) => {
      release(filesRef.current[side]);
      const id = nextId++;
      const invalid = checkFile(file);
      setFiles((current) => ({
        ...current,
        [side]: { id, fileName: file.name, sizeBytes: file.size, status: invalid ? 'error' : 'uploading', error: invalid?.message, issues: [] },
      }));
      if (invalid) return;
      if (/\.(pdf|ai)$/i.test(file.name)) {
        // Thumbnails of every page while it uploads; files pdf.js cannot open just wait for the check.
        openPdf(file)
          .then((source) =>
            setFiles((current) => {
              const now = current[side];
              if (now?.id !== id) {
                void source.doc.destroy();
                return current;
              }
              return { ...current, [side]: { ...now, source, sourcePageCount: now.sourcePageCount ?? source.pageCount } };
            }),
          )
          .catch(() => undefined);
      }
      try {
        const { key } = await uploadArtwork(file);
        update(side, id, { status: 'checking', sourceKey: key });
      } catch (err) {
        update(side, id, { status: 'error', error: err instanceof Error ? err.message : 'The upload failed. Please try again.' });
      }
    },
    [update],
  );

  /** Checks an uploaded file for `request`; results of an older check of the same file are dropped. */
  const check = useCallback(async (side: FileSide, id: number, sourceKey: string, request: ArtworkCheckRequest) => {
    const tag = JSON.stringify(request);
    const current = (file: PdfFileState | undefined) => file?.id === id && file.checkedFor === tag;
    setFiles((files) => (files[side]?.id === id ? { ...files, [side]: { ...files[side]!, status: 'checking', checkedFor: tag, error: undefined } } : files));
    try {
      const result = await checkArtwork(sourceKey, request);
      const issues = result.issues.map((i): CheckResult => ({ level: i.level, message: i.message }));
      let pdf: OpenedPdf | undefined;
      if (result.key && result.url) {
        const response = await fetch(result.url);
        if (!response.ok) throw new Error('Could not load the checked file. Please try again.');
        pdf = await openPdf(await response.blob());
      }
      setFiles((files) => {
        const file = files[side];
        if (!current(file)) {
          void pdf?.doc.destroy();
          return files;
        }
        void file!.pdf?.doc.destroy();
        // No print PDF: the file cannot be used at all (RGB image, unsupported type…); the issues say why.
        const next: PdfFileState = pdf
          ? { ...file!, status: 'ready', issues, pdf, key: result.key!, sourcePageCount: result.sourcePageCount }
          : { ...file!, status: 'error', issues, pdf: undefined, key: undefined, sourcePageCount: result.sourcePageCount };
        return { ...files, [side]: next };
      });
    } catch (err) {
      const message = err instanceof PdfReadError || err instanceof Error ? err.message : 'We could not check this file.';
      setFiles((files) => (current(files[side]) ? { ...files, [side]: { ...files[side]!, status: 'error', error: message, issues: [] } } : files));
    }
  }, []);

  /** The customer picks which pages of the file are printed as the front and back; the file is checked again. */
  const choosePages = useCallback((side: FileSide, pages: number[]) => {
    const file = filesRef.current[side];
    if (file) update(side, file.id, { pages });
  }, [update]);

  useEffect(
    () => () => {
      for (const file of Object.values(filesRef.current)) release(file);
    },
    [],
  );

  return { files, addFile, removeFile, check, choosePages };
}

/**
 * Checks each uploaded file for the chosen card, and again whenever the card size changes or a
 * separate back file is added or removed (page 2 of the front file is the back only without one).
 */
export function useArtworkChecks(
  pdfFiles: ReturnType<typeof usePdfFiles>,
  geometry: ArtworkCheckRequest['geometry'],
  backMode: BackMode,
) {
  const { files, check } = pdfFiles;
  const { widthIn, heightIn, bleedIn, safeIn } = geometry;
  useEffect(() => {
    for (const side of ['front', 'back'] as const) {
      const file = files[side];
      if (!file?.sourceKey) continue;
      const maxPages = side === 'front' && backMode === 'separate' && !files.back ? 2 : 1;
      // A pick of pages keeps only what is printed: the front alone when the back is not from this file.
      const pages = file.pages?.slice(0, maxPages);
      const request: ArtworkCheckRequest = { geometry: { widthIn, heightIn, bleedIn, safeIn }, side, maxPages, ...(pages ? { pages } : {}) };
      if (file.checkedFor !== JSON.stringify(request)) void check(side, file.id, file.sourceKey, request);
    }
  }, [files, check, backMode, widthIn, heightIn, bleedIn, safeIn]);
}

interface PageSource {
  file: PdfFileState;
  pageIndex: number;
}

export interface UploadChecks {
  front: CheckResult[];
  back: CheckResult[];
}

/** Which file/page feeds each side, and the findings for the selected size and printed side. */
export function useArtworkSources(files: Files, size: ExpectedSize, backMode: BackMode) {
  return useMemo(() => {
    const front = files.front?.status === 'ready' ? files.front : undefined;
    const backFile = files.back?.status === 'ready' ? files.back : undefined;

    const frontSource: PageSource | null = front ? { file: front, pageIndex: 0 } : null;
    let backSource: PageSource | null = null;
    if (backMode === 'separate') {
      if (backFile) backSource = { file: backFile, pageIndex: 0 };
      else if (front && front.pdf!.pageCount >= 2) backSource = { file: front, pageIndex: 1 };
    }

    // The server check reports size problems; here the size only decides how the preview is cropped.
    const hasBleed = (source: PageSource | null) => (source ? checkPageSize(source.file.pdf!.pages[source.pageIndex]!, size).hasBleed : false);
    const errorOf = (file: PdfFileState | undefined): CheckResult[] =>
      file?.status === 'error' && file.error ? [{ level: 'error', message: file.error }] : [];

    const checks: UploadChecks = {
      front: [...(files.front?.issues ?? []), ...errorOf(files.front)],
      back: backMode === 'separate' ? [...(files.back?.issues ?? []), ...errorOf(files.back)] : [],
    };
    // Multi-page files show a page picker instead of "page 2 is the back" notes.
    if (front && (front.sourcePageCount ?? 1) <= 1) {
      checks.front.push(...checkPages(front.pdf!.pageCount, backMode === 'separate' && backFile ? backFile.pdf!.pageCount : null, backMode));
    }

    return {
      front: frontSource ? { ...frontSource, cropPt: hasBleed(frontSource) ? size.bleedIn * 72 : 0 } : null,
      back: backSource ? { ...backSource, cropPt: hasBleed(backSource) ? size.bleedIn * 72 : 0 } : null,
      checks,
    };
  }, [files, size, backMode]);
}

/** Renders a page to an image URL for the 3D card; re-renders when the crop changes. */
export function usePageImage(source: (PageSource & { cropPt: number }) | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const doc = source?.file.pdf?.doc;
  const pageIndex = source?.pageIndex;
  const cropPt = source?.cropPt;

  useEffect(() => {
    if (!doc || pageIndex === undefined || cropPt === undefined) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    renderPageImage(doc, pageIndex, cropPt)
      .then((image) => {
        created = image;
        if (cancelled) URL.revokeObjectURL(image);
        else setUrl(image);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [doc, pageIndex, cropPt]);

  return url;
}

/** Small images of the first `count` pages (at most `max`) for picking pages and showing what prints. */
export function usePageThumbnails(doc: OpenedPdf['doc'] | undefined, count: number, max = 20): (string | null)[] {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const pages = Math.min(count, max);
  useEffect(() => {
    if (!doc || pages === 0) {
      setUrls([]);
      return;
    }
    let cancelled = false;
    const created: string[] = [];
    setUrls(Array(pages).fill(null));
    void (async () => {
      for (let index = 0; index < pages && !cancelled; index++) {
        try {
          const url = await renderPageImage(doc, index, 0, THUMBNAIL_PX_PER_INCH);
          created.push(url);
          if (cancelled) break;
          setUrls((current) => current.map((u, i) => (i === index ? url : u)));
        } catch {
          // A page that cannot be drawn keeps its placeholder.
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [doc, pages]);
  return urls;
}

/** About 150 px across a business card: sharp at thumbnail size, quick to draw. */
const THUMBNAIL_PX_PER_INCH = 40;

