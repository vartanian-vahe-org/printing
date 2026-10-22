'use client';

import { fieldFamilies, unsupportedCharacters, type RenderWarning, type Template, type TemplateField } from '@printing/templates';
import { useId, useState } from 'react';
import { LOGO_TYPES, LogoFileError, readLogo } from '../../lib/logo-file';
import styles from './design.module.css';

interface Props {
  selected: Template | null;
  fields: TemplateField[];
  values: Record<string, string>;
  warnings: RenderWarning[];
  notice: string | null;
  /** Back to the template list. */
  onChangeTemplate: () => void;
  onChangeValue: (key: string, value: string) => void;
}

/** Step 3 with a template: the customer's text and logo, shown live on the card preview. */
export function DesignPanel(props: Props) {
  const { selected, fields, values, warnings, notice } = props;

  if (!selected) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Choose a template first.</p>
        <button type="button" className={styles.linkButton} onClick={props.onChangeTemplate}>
          Browse templates
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.chosen}>
        <span>
          Template: <strong>{selected.name}</strong>
        </span>
        <button type="button" className={styles.linkButton} onClick={props.onChangeTemplate}>
          Change template
        </button>
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
              unprintable={
                selected
                  ? [...new Set(fieldFamilies(selected.layout, field.key).flatMap((family) => unsupportedCharacters(values[field.key] ?? '', family)))]
                  : []
              }
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
  unprintable,
  onChange,
}: {
  field: TemplateField;
  value: string;
  tooLong: boolean;
  /** Characters the template font cannot print (emoji…); the cart refuses them too. */
  unprintable: string[];
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
        aria-invalid={tooLong || unprintable.length > 0 || undefined}
        onChange={(e) => onChange(field.key, e.target.value)}
      />
      {tooLong && <span className={styles.warning}>Too long to fit at a readable size. Try a shorter version.</span>}
      {unprintable.length > 0 && <span className={styles.warning}>We can&apos;t print {unprintable.join(' ')}. Please remove {unprintable.length === 1 ? 'it' : 'them'}.</span>}
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
