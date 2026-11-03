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
  /** The print PDF made by the check: opened for the preview; its key goes in the cart. */
  pdf?: OpenedPdf;
  key?: string;
}

type Files = Partial<Record<FileSide, PdfFileState>>;

let nextId = 1;

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
    void filesRef.current[side]?.pdf?.doc.destroy();
    setFiles((current) => {
      const next = { ...current };
      delete next[side];
      return next;
    });
  }, []);

  /** Uploads the file; useArtworkChecks then checks it for the chosen card. */
  const addFile = useCallback(
    async (side: FileSide, file: File) => {
      void filesRef.current[side]?.pdf?.doc.destroy();
      const id = nextId++;
      const invalid = checkFile(file);
      setFiles((current) => ({
        ...current,
        [side]: { id, fileName: file.name, sizeBytes: file.size, status: invalid ? 'error' : 'uploading', error: invalid?.message, issues: [] },
      }));
      if (invalid) return;
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
          ? { ...file!, status: 'ready', issues, pdf, key: result.key! }
          : { ...file!, status: 'error', issues, pdf: undefined, key: undefined };
        return { ...files, [side]: next };
      });
    } catch (err) {
      const message = err instanceof PdfReadError || err instanceof Error ? err.message : 'We could not check this file.';
      setFiles((files) => (current(files[side]) ? { ...files, [side]: { ...files[side]!, status: 'error', error: message, issues: [] } } : files));
    }
  }, []);

  useEffect(
    () => () => {
      for (const file of Object.values(filesRef.current)) void file?.pdf?.doc.destroy();
    },
    [],
  );

  return { files, addFile, removeFile, check };
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
      const request: ArtworkCheckRequest = { geometry: { widthIn, heightIn, bleedIn, safeIn }, side, maxPages };
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
    if (front) {
      checks.front.push(
        ...checkPages(front.pdf!.pageCount, backMode === 'separate' && backFile ? backFile.pdf!.pageCount : null, backMode),
      );
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
