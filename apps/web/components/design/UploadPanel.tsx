'use client';

import { useId, useState, type DragEvent } from 'react';
import type { BackMode } from '../../lib/card3d';
import { formatInches } from '../../lib/format';
import { worstLevel, type CheckResult, type ExpectedSize } from '../../lib/pdf-checks';
import { ARTWORK_ACCEPT } from '../../lib/upload';
import type { OpenedPdf } from '../../lib/pdf-render';
import { usePageThumbnails, type FileSide, type PdfFileState, type UploadChecks } from '../../lib/use-pdf-artwork';
import styles from './design.module.css';

interface Props {
  files: Partial<Record<FileSide, PdfFileState>>;
  checks: UploadChecks;
  backMode: BackMode;
  size: ExpectedSize;
  onAdd: (side: FileSide, file: File) => void;
  onRemove: (side: FileSide) => void;
  /** The customer picked which pages of a multi-page file are printed (front, then back), 1-based. */
  onChoosePages: (side: FileSide, pages: number[]) => void;
  /** The size chosen in step 1 (e.g. "Slim 3.5" x 1.75""), with a way back to change it. */
  sizeName?: string;
  onChangeSize?: () => void;
}

export function UploadPanel({ files, checks, backMode, size, onAdd, onRemove, onChoosePages, sizeName, onChangeSize }: Props) {
  const bleedW = formatInches(size.widthIn + 2 * size.bleedIn);
  const bleedH = formatInches(size.heightIn + 2 * size.bleedIn);

  return (
    <div className={styles.panel}>
      {sizeName && (
        <div className={styles.chosen}>
          <span>
            Size: <strong>{sizeName}</strong>
          </span>
          {onChangeSize && (
            <button type="button" className={styles.linkButton} onClick={onChangeSize}>
              Change size
            </button>
          )}
        </div>
      )}
      <div className={styles.guide}>
        <strong>File setup</strong>
        <ul>
          <li>
            {bleedW} × {bleedH} in: the {formatInches(size.widthIn)} × {formatInches(size.heightIn)} finished size plus{' '}
            {formatInches(size.bleedIn)} bleed on every side
          </li>
          <li>
            <strong>CMYK colors</strong> (no RGB, no Pantone) and images of at least <strong>300 DPI</strong>
          </li>
          <li>PDF with fonts embedded (or text converted to outlines), AI, TIFF, JPG or PSD</li>
          <li>Keep text and logos {formatInches(size.bleedIn)} inside the trim line</li>
          <li>Up to 200 MB. Front and back can be one 2-page PDF.</li>
        </ul>
        <details className={styles.guideHelp}>
          <summary>How do I export a CMYK file?</summary>
          <ul>
            <li>Illustrator: File › Document Color Mode › CMYK Color, then Save As › Adobe PDF (Press Quality).</li>
            <li>Photoshop: Image › Mode › CMYK Color, then save as TIFF or PDF.</li>
            <li>InDesign: File › Export › Adobe PDF (Print), Output › Convert to Destination (CMYK).</li>
            <li>Canva: Share › Download › PDF Print, color profile CMYK (Canva Pro).</li>
          </ul>
          <p>No design software? Use one of our templates, or let our designer make the file for you.</p>
        </details>
      </div>

      <FileDrop
        side="front"
        label="Front"
        file={files.front}
        checks={checks.front}
        // The back comes from this file too unless there is a separate back file.
        roles={backMode === 'separate' && !files.back ? ['Front', 'Back'] : ['Front']}
        onAdd={onAdd}
        onRemove={onRemove}
        onChoosePages={onChoosePages}
      />
      {backMode === 'separate' && (
        <FileDrop
          side="back"
          label="Back"
          file={files.back}
          checks={checks.back}
          roles={['Back']}
          onAdd={onAdd}
          onRemove={onRemove}
          onChoosePages={onChoosePages}
        />
      )}
    </div>
  );
}

const LEVEL_ICON: Record<CheckResult['level'], string> = { ok: '✓', info: 'i', warning: '!', error: '×' };

function FileDrop({
  side,
  label,
  file,
  checks,
  roles,
  onAdd,
  onRemove,
  onChoosePages,
}: {
  side: FileSide;
  label: string;
  file: PdfFileState | undefined;
  checks: CheckResult[];
  /** What the pages of this file are printed as, in order. */
  roles: string[];
  onAdd: (side: FileSide, file: File) => void;
  onRemove: (side: FileSide) => void;
  onChoosePages: (side: FileSide, pages: number[]) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onAdd(side, dropped);
  }

  const results = checks;
  const busy = file?.status === 'uploading' || file?.status === 'checking';
  const level = worstLevel(results);

  return (
    <div className={styles.fileBlock}>
      <div className={styles.fileHeader}>
        <span className={styles.label}>{label}</span>
      </div>

      <input
        id={inputId}
        type="file"
        accept={ARTWORK_ACCEPT}
        className={styles.fileInput}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onAdd(side, picked);
          e.target.value = '';
        }}
      />

      {!file ? (
        <label
          htmlFor={inputId}
          className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className={styles.dropTitle}>Drag your file here</span>
          <span className={styles.hint}>or click to choose a file</span>
        </label>
      ) : (
        <div className={styles.fileCard} data-level={busy ? 'info' : level}>
          <div className={styles.fileRow}>
            <span className={styles.fileName} title={file.fileName}>
              {file.fileName}
            </span>
            <span className={styles.fileSize}>{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
          </div>

          {file.status === 'uploading' && <p className={styles.hint}>Uploading…</p>}
          {file.status === 'checking' && <p className={styles.hint}>Checking your file: size, resolution, CMYK colors and fonts…</p>}
          {file.status === 'ready' && level !== 'error' && <p className={styles.uploadState}>File checked</p>}

          {file.sourcePageCount && file.sourcePageCount > 1 && file.status !== 'error' ? (
            <PagePicker
              doc={file.source?.doc}
              pageCount={file.sourcePageCount}
              roles={roles}
              pages={file.pages ?? roles.map((_, i) => i + 1)}
              disabled={file.status === 'checking'}
              onChange={(pages) => onChoosePages(side, pages)}
            />
          ) : (
            file.status === 'ready' && file.pdf && <PrintedPages pdf={file.pdf} roles={roles} />
          )}

          {results.length > 0 && (
            <ul className={styles.checks}>
              {results.map((result) => (
                <li key={result.message} data-level={result.level}>
                  <span className={styles.checkIcon} aria-hidden="true">
                    {LEVEL_ICON[result.level]}
                  </span>
                  {result.message}
                </li>
              ))}
            </ul>
          )}

          <div className={styles.fileActions}>
            <label htmlFor={inputId} className={styles.linkButton}>
              Replace
            </label>
            <button type="button" className={styles.linkButton} onClick={() => onRemove(side)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Thumbnails of what is printed from this file (the checked print PDF): front, and back when it comes from here. */
function PrintedPages({ pdf, roles }: { pdf: OpenedPdf; roles: string[] }) {
  const shown = roles.slice(0, pdf.pageCount);
  const urls = usePageThumbnails(pdf.doc, shown.length);
  return (
    <div className={styles.thumbs}>
      {shown.map((role, index) => (
        <figure key={role} className={styles.thumb}>
          <Thumbnail url={urls[index] ?? null} alt={`${role} of your design`} />
          <figcaption>{role}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  return url ? <img src={url} alt={alt} className={styles.thumbImage} /> : <span className={styles.thumbLoading} aria-hidden="true" />;
}

/** Most pages shown as thumbnails; longer files pick from a list. */
const MAX_THUMBNAIL_PAGES = 12;

/**
 * Which page of a multi-page file is the front, and which the back: thumbnails of every page with
 * a button per side, or lists when the file cannot be shown (not a PDF, very long). Picking the
 * other side's page swaps them.
 */
function PagePicker({
  doc,
  pageCount,
  roles,
  pages,
  disabled,
  onChange,
}: {
  doc: OpenedPdf['doc'] | undefined;
  pageCount: number;
  roles: string[];
  pages: number[];
  disabled: boolean;
  onChange: (pages: number[]) => void;
}) {
  const current = roles.map((_, i) => pages[i] ?? i + 1);
  const withThumbnails = Boolean(doc) && pageCount <= MAX_THUMBNAIL_PAGES;
  const urls = usePageThumbnails(withThumbnails ? doc : undefined, pageCount, MAX_THUMBNAIL_PAGES);
  function pick(index: number, page: number) {
    const next = [...current];
    const other = next.indexOf(page);
    if (other !== -1 && other !== index) next[other] = current[index]!;
    next[index] = page;
    onChange(next);
  }
  const swap =
    roles.length === 2 ? (
      <button type="button" className={styles.linkButton} disabled={disabled} onClick={() => onChange([current[1]!, current[0]!])}>
        ⇄ Swap front and back
      </button>
    ) : null;

  return (
    <div className={styles.pagePicker}>
      <span className={styles.pagePickerTitle}>
        Your file has {pageCount} pages. Choose the {roles.length === 2 ? 'front and back' : roles[0]!.toLowerCase()}.
      </span>
      {withThumbnails ? (
        <>
          <div className={styles.thumbs}>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
              const role = roles[current.indexOf(page)];
              return (
                <figure key={page} className={styles.thumb} data-role={role ? role.toLowerCase() : undefined}>
                  <Thumbnail url={urls[page - 1] ?? null} alt={`Page ${page}`} />
                  <figcaption>
                    Page {page}
                    {role && <strong> · {role}</strong>}
                  </figcaption>
                  <div className={styles.thumbActions}>
                    {roles.map((r, index) => (
                      <button
                        key={r}
                        type="button"
                        className={styles.thumbButton}
                        aria-pressed={current[index] === page}
                        disabled={disabled}
                        onClick={() => pick(index, page)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </figure>
              );
            })}
          </div>
          {swap}
        </>
      ) : (
        <div className={styles.pagePickerRow}>
          {roles.map((role, index) => (
            <label key={role} className={styles.pagePickerField}>
              <span>{role}</span>
              <select value={current[index]} disabled={disabled} onChange={(e) => pick(index, Number(e.target.value))}>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
                  <option key={page} value={page}>
                    Page {page}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {swap}
        </div>
      )}
    </div>
  );
}
