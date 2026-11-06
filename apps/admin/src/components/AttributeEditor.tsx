/**
 * Form for an option value's attributes (sizes, thickness, coating finishes...). Renders one input
 * per key based on the current value's type; the API validates the result per option group.
 */

const ENUMS: Record<string, string[]> = {
  front: ['matte', 'gloss', 'uv', 'soft_touch', 'silk', 'none'],
  back: ['matte', 'gloss', 'uv', 'soft_touch', 'silk', 'none'],
};
const PRINTED_SIDE_BACK = ['separate', 'blank', 'same_as_front'];
const OPTION_LABELS: Record<string, string> = { separate: 'Own design', blank: 'Left blank', same_as_front: 'Same as the front' };

const LABELS: Record<string, string> = {
  trim_w_in: 'Trim width (in)',
  trim_h_in: 'Trim height (in)',
  bleed_in: 'Bleed (in)',
  safe_in: 'Safe margin (in)',
  thickness_pt: 'Thickness (pt)',
  tier: 'Tier',
  front: 'Front finish',
  back: 'Back',
  laminated: 'Laminated',
  radius_in: 'Corner radius (in)',
  min_days: 'First day (business days)',
  max_days: 'Last day (business days)',
  percent: 'Percent of the price',
};

interface Props {
  groupCode: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

export function AttributeEditor({ groupCode, value, onChange }: Props) {
  // Stored JSON does not keep the key order: show known fields in the order of LABELS.
  const order = Object.keys(LABELS);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const keys = Object.keys(value).sort((a, b) => rank(a) - rank(b));
  if (keys.length === 0) return <p className="muted">No attributes.</p>;

  return (
    <div className="attr-grid">
      {keys.map((key) => {
        const current = value[key];
        const label = LABELS[key] ?? key;
        const set = (next: unknown) => onChange({ ...value, [key]: next });

        if (typeof current === 'boolean') {
          return (
            <label key={key} className="field field-inline">
              <input type="checkbox" checked={current} onChange={(e) => set(e.target.checked)} />
              <span>{label}</span>
            </label>
          );
        }
        if (typeof current === 'number') {
          return (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                type="number"
                step="any"
                required
                value={Number.isFinite(current) ? current : ''}
                onChange={(e) => set(e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
            </label>
          );
        }
        if (current && typeof current === 'object' && !Array.isArray(current)) {
          return (
            <fieldset key={key} className="attr-nested">
              <legend>{label}</legend>
              <AttributeEditor groupCode={groupCode} value={current as Record<string, unknown>} onChange={set} />
            </fieldset>
          );
        }
        const options = groupCode === 'printed_side' && key === 'back' ? PRINTED_SIDE_BACK : ENUMS[key];
        if (options) {
          return (
            <label key={key} className="field">
              <span>{label}</span>
              <select value={String(current)} onChange={(e) => set(e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {OPTION_LABELS[o] ?? o}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={key} className="field">
            <span>{label}</span>
            <input type="text" required value={String(current ?? '')} onChange={(e) => set(e.target.value)} />
          </label>
        );
      })}
    </div>
  );
}
