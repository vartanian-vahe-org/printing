'use client';

import type { RenderWarning, Template, TemplateField } from '@printing/templates';
import { useId, useState } from 'react';
import { svgDataUrl } from '../../lib/design-state';
import { LOGO_TYPES, LogoFileError, readLogo } from '../../lib/logo-file';
import styles from './design.module.css';

interface Props {
  /** Templates that support the selected size. */
  templates: Template[];
  selected: Template | null;
  /** Front-side thumbnail SVG per template code, rendered with the customer's values. */
  thumbnails: Record<string, string>;
  fields: TemplateField[];
  values: Record<string, string>;
  warnings: RenderWarning[];
  notice: string | null;
  onSelectTemplate: (code: string) => void;
  onChangeValue: (key: string, value: string) => void;
}

export function DesignPanel(props: Props) {
  const { templates, selected, thumbnails, fields, values, warnings, notice } = props;

  if (templates.length === 0) {
    return <p className={styles.empty}>No templates are available for this size yet. Try a standard size.</p>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.picker} role="radiogroup" aria-label="Template">
        {templates.map((template) => {
          const active = template.code === selected?.code;
          return (
            <button
              key={template.code}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.thumb} ${active ? styles.thumbActive : ''}`}
              onClick={() => props.onSelectTemplate(template.code)}
              title={template.description ?? template.name}
            >
              {thumbnails[template.code] && (
                <img src={svgDataUrl(thumbnails[template.code]!)} alt="" className={styles.thumbImage} />
              )}
              <span className={styles.thumbName}>{template.name}</span>
            </button>
          );
        })}
      </div>

      {notice && (
        <p className={styles.notice} aria-live="polite">
          {notice}
        </p>
      )}

      <p className={styles.helper}>Sample text is shown until you type your own.</p>

      <div className={styles.fields}>
        {fields.map((field) =>
          field.type === 'image' ? (
            <LogoField key={field.key} field={field} value={values[field.key]} onChange={props.onChangeValue} />
          ) : (
            <TextField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              tooLong={warnings.some((w) => w.field === field.key)}
              onChange={props.onChangeValue}
            />
          ),
        )}
      </div>
    </div>
  );
}

const INPUT_TYPE = { text: 'text', tel: 'tel', email: 'email', url: 'url' } as const;

function TextField({
  field,
  value,
  tooLong,
  onChange,
}: {
  field: TemplateField;
  value: string;
  tooLong: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {field.label}
      </label>
      <input
        id={id}
        className={styles.input}
        type={INPUT_TYPE[field.inputMode]}
        inputMode={field.inputMode}
        value={value}
        maxLength={field.maxLength}
        placeholder={field.sample}
        autoComplete="off"
        aria-invalid={tooLong || undefined}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
      {tooLong && <span className={styles.warning}>Too long to fit at a readable size. Try a shorter version.</span>}
    </div>
  );
}

function LogoField({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string | undefined;
  onChange: (key: string, value: string) => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      onChange(field.key, await readLogo(file));
    } catch (err) {
      setError(err instanceof LogoFileError ? err.message : 'Could not use this file');
    }
  }

  return (
    <div className={`${styles.field} ${styles.logoField}`}>
      <span className={styles.label}>{field.label}</span>
      <div className={styles.logoRow}>
        {value ? (
          <img src={value} alt="Your logo" className={styles.logoPreview} />
        ) : (
          <span className={styles.logoEmpty}>No logo</span>
        )}
        <label htmlFor={id} className={styles.fileButton}>
          {value ? 'Replace' : 'Upload logo'}
        </label>
        <input
          id={id}
          type="file"
          accept={LOGO_TYPES.join(',')}
          className={styles.fileInput}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {value && (
          <button type="button" className={styles.linkButton} onClick={() => onChange(field.key, '')}>
            Remove
          </button>
        )}
      </div>
      {error && <span className={styles.warning}>{error}</span>}
      <span className={styles.hint}>PNG, JPG, WebP or SVG, up to 5 MB. Transparent PNG or SVG looks best.</span>
    </div>
  );
}
