'use client';

/**
 * State for "Upload your design": the front file, an optional back file, their checks,
 * the storage upload, and the page images shown on the 3D card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BackMode } from './card3d';
import {
  checkFile,
  checkPages,
  checkPageSize,
  type CheckResult,
  type ExpectedSize,
  type PageSizeCheck,
} from './pdf-checks';
import { openPdf, PdfReadError, renderPageImage, type OpenedPdf } from './pdf-render';
import { uploadArtwork } from './upload';

export type FileSide = 'front' | 'back';

export interface PdfFileState {
  id: number;
  fileName: string;
  sizeBytes: number;
  status: 'reading' | 'ready' | 'error';
  error?: string;
  pdf?: OpenedPdf;
  upload: 'idle' | 'uploading' | 'done' | 'failed';
  uploadError?: string;
  /** Storage key once uploaded. */
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

  const addFile = useCallback(
    async (side: FileSide, file: File) => {
      void filesRef.current[side]?.pdf?.doc.destroy();
      const id = nextId++;
      const invalid = checkFile(file);
      setFiles((current) => ({
        ...current,
        [side]: {
          id,
          fileName: file.name,
          sizeBytes: file.size,
          status: invalid ? 'error' : 'reading',
          error: invalid?.message,
          upload: 'idle',
        },
      }));
      if (invalid) return;

      try {
        const pdf = await openPdf(file);
        update(side, id, { status: 'ready', pdf, upload: 'uploading' });
      } catch (err) {
        update(side, id, { status: 'error', error: err instanceof PdfReadError ? err.message : 'This PDF could not be opened.' });
        return;
      }
      try {
        const { key } = await uploadArtwork(file);
        update(side, id, { upload: 'done', key });
      } catch (err) {
        update(side, id, { upload: 'failed', uploadError: err instanceof Error ? err.message : 'Upload failed' });
      }
    },
    [update],
  );

  useEffect(
    () => () => {
      for (const file of Object.values(filesRef.current)) void file?.pdf?.doc.destroy();
    },
    [],
  );

  return { files, addFile, removeFile };
}

interface PageSource {
  file: PdfFileState;
  pageIndex: number;
}

export interface UploadChecks {
  front: CheckResult[];
  back: CheckResult[];
}

/** Which file/page feeds each side, and the checks for the selected size and printed side. */
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

    const sizeCheck = (source: PageSource | null): PageSizeCheck | null =>
      source ? checkPageSize(source.file.pdf!.pages[source.pageIndex]!, size) : null;
    const frontSize = sizeCheck(frontSource);
    const backSize = sizeCheck(backSource);

    const checks: UploadChecks = { front: [], back: [] };
    if (frontSize) checks.front.push(frontSize);
    if (front) {
      checks.front.push(
        ...checkPages(front.pdf!.pageCount, backMode === 'separate' && backFile ? backFile.pdf!.pageCount : null, backMode),
      );
    }
    if (backSize) {
      if (backSource!.file === backFile) checks.back.push(backSize);
      // Back taken from page 2 of the front file: only mention it when something is off.
      else if (backSize.level !== 'ok') checks.front.push({ ...backSize, message: `Page 2: ${backSize.message}` });
    }

    return {
      front: frontSource ? { ...frontSource, cropPt: frontSize!.hasBleed ? size.bleedIn * 72 : 0 } : null,
      back: backSource ? { ...backSource, cropPt: backSize!.hasBleed ? size.bleedIn * 72 : 0 } : null,
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
