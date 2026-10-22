'use client';

import { useId, useState, type DragEvent } from 'react';
import type { BackMode } from '../../lib/card3d';
import { formatInches } from '../../lib/format';
import { worstLevel, type CheckResult, type ExpectedSize } from '../../lib/pdf-checks';
import type { FileSide, PdfFileState, UploadChecks } from '../../lib/use-pdf-artwork';
import styles from './design.module.css';

interface Props {
  files: Partial<Record<FileSide, PdfFileState>>;
  checks: UploadChecks;
  backMode: BackMode;
  size: ExpectedSize;
  onAdd: (side: FileSide, file: File) => void;
  onRemove: (side: FileSide) => void;
  /** The card size chosen in step 1 (e.g. "Slim 3.5" x 1.75""), with a way back to change it. */
  sizeName?: string;
  onChangeSize?: () => void;
}

export function UploadPanel({ files, checks, backMode, size, onAdd, onRemove, sizeName, onChangeSize }: Props) {
  const bleedW = formatInches(size.widthIn + 2 * size.bleedIn);
  const bleedH = formatInches(size.heightIn + 2 * size.bleedIn);

  return (
    <div className={styles.panel}>
      {sizeName && (
        <div className={styles.chosen}>
          <span>
            Card size: <strong>{sizeName}</strong>
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
            PDF at {bleedW} × {bleedH}: your {formatInches(size.widthIn)} × {formatInches(size.heightIn)} card plus{' '}
            {formatInches(size.bleedIn)} bleed on every side
          </li>
          <li>Keep text and logos {formatInches(size.bleedIn)} inside the trim line</li>
          <li>Up to 50 MB. Front and back can be one 2-page PDF.</li>
        </ul>
      </div>

      <FileDrop side="front" label="Front" file={files.front} checks={checks.front} onAdd={onAdd} onRemove={onRemove} />
      {backMode === 'separate' && (
        <FileDrop
          side="back"
          label="Back"
          optionalHint="Optional if your front PDF has 2 pages"
          file={files.back}
          checks={checks.back}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

const LEVEL_ICON: Record<CheckResult['level'], string> = { ok: '✓', info: 'i', warning: '!', error: '×' };

function FileDrop({
  side,
  label,
  optionalHint,
  file,
  checks,
  onAdd,
  onRemove,
}: {
  side: FileSide;
  label: string;
  optionalHint?: string;
  file: PdfFileState | undefined;
  checks: CheckResult[];
  onAdd: (side: FileSide, file: File) => void;
  onRemove: (side: FileSide) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onAdd(side, dropped);
  }

  const results = file?.status === 'error' ? [{ level: 'error' as const, message: file.error ?? 'Invalid file' }] : checks;
  const level = worstLevel(results);

  return (
    <div className={styles.fileBlock}>
      <div className={styles.fileHeader}>
        <span className={styles.label}>{label}</span>
        {optionalHint && !file && <span className={styles.hint}>{optionalHint}</span>}
      </div>

      <input
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
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
          <span className={styles.dropTitle}>Drag your PDF here</span>
          <span className={styles.hint}>or click to choose a file</span>
        </label>
      ) : (
        <div className={styles.fileCard} data-level={file.status === 'reading' ? 'info' : level}>
          <div className={styles.fileRow}>
            <span className={styles.fileName} title={file.fileName}>
              {file.fileName}
            </span>
            <span className={styles.fileSize}>{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
          </div>

          {file.status === 'reading' && <p className={styles.hint}>Checking your file…</p>}

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

          {file.status === 'ready' && (
            <p className={styles.uploadState} data-state={file.upload}>
              {file.upload === 'uploading' && 'Uploading…'}
              {file.upload === 'done' && 'Uploaded'}
              {file.upload === 'failed' && `Not uploaded: ${file.uploadError}. Your preview still works.`}
            </p>
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
