import { useEffect, useMemo, useState } from 'react';
import { api, productPath, type AdminCatalog, type AdminGroup } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

/**
 * "When the customer picks X, only these options are available in group Y."
 * Example: paper 14pt -> coatings available, turnaround available.
 */
export function RulesPage() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  const [when, setWhen] = useState<{ group: string; value: string }>({ group: 'paper', value: '14pt' });

  if (!catalog) return <p className="page-loading">Loading…</p>;
  const whenGroup = catalog.groups.find((g) => g.code === when.group)!;
  const whenValue = whenGroup.values.find((v) => v.code === when.value)!;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Rules</h1>
          <p className="muted">
            Choose an option on the left, then tick what customers can combine it with. Unticked options are hidden on the storefront.
          </p>
        </div>
      </header>

      <div className="rules-layout">
        <nav className="card rules-picker" aria-label="Option">
          {catalog.groups.map((group) => (
            <div key={group.code} className="rules-picker-group">
              <h3>{group.label}</h3>
              {group.values.map((value) => {
                const count = catalog.rules.filter((r) => r.whenGroup === group.code && r.whenValue === value.code).length;
                const active = group.code === when.group && value.code === when.value;
                return (
                  <button
                    key={value.code}
                    type="button"
                    className={`rules-picker-item ${active ? 'rules-picker-active' : ''}`}
                    onClick={() => setWhen({ group: group.code, value: value.code })}
                  >
                    <span>{value.label}</span>
                    {count > 0 && <span className="tab-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="rules-detail">
          <h2>
            When the customer picks <em>{whenValue.label}</em>
          </h2>
          {catalog.groups
            .filter((g) => g.code !== when.group)
            .map((target) => (
              <TargetRule key={`${when.group}.${when.value}.${target.code}`} catalog={catalog} when={when} target={target} saver={saver} />
            ))}
        </div>
      </div>

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function TargetRule({
  catalog,
  when,
  target,
  saver,
}: {
  catalog: AdminCatalog;
  when: { group: string; value: string };
  target: AdminGroup;
  saver: ReturnType<typeof useSaver>;
}) {
  const rule = catalog.rules.find((r) => r.whenGroup === when.group && r.whenValue === when.value && r.targetGroup === target.code);
  const allCodes = useMemo(() => target.values.map((v) => v.code), [target]);
  const [checked, setChecked] = useState<string[]>(rule?.allowed ?? allCodes);
  useEffect(() => setChecked(rule?.allowed ?? allCodes), [rule, allCodes]);

  const dirty = [...checked].sort().join() !== [...(rule?.allowed ?? allCodes)].sort().join();
  const unrestricted = checked.length === allCodes.length;

  function save() {
    void saver.save(
      () =>
        api(`${productPath}/rules`, {
          method: 'PUT',
          body: { whenGroup: when.group, whenValue: when.value, targetGroup: target.code, allowed: unrestricted ? null : checked },
        }),
      unrestricted ? `${target.label}: no restriction` : `${target.label} rule saved`,
    );
  }

  return (
    <section className="card rule-card">
      <div className="rule-card-header">
        <h3>{target.label} available</h3>
        <span className={`badge ${rule ? 'badge-rule' : ''}`}>{rule ? `${rule.allowed.length} of ${allCodes.length}` : 'No restriction'}</span>
      </div>
      <div className="checks">
        {target.values.map((value) => (
          <label key={value.code} className={`check ${value.isActive ? '' : 'check-hidden'}`}>
            <input
              type="checkbox"
              checked={checked.includes(value.code)}
              onChange={(e) => setChecked(e.target.checked ? [...checked, value.code] : checked.filter((c) => c !== value.code))}
            />
            <span>{value.label}</span>
            {!value.isActive && <small>(hidden)</small>}
          </label>
        ))}
      </div>
      {dirty && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={saver.saving || checked.length === 0} onClick={save}>
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setChecked(rule?.allowed ?? allCodes)}>
            Undo
          </button>
          {checked.length === 0 && <span className="form-error">Tick at least one option.</span>}
        </div>
      )}
    </section>
  );
}
