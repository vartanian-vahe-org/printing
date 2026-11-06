import { useCallback, useRef, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, type AdminCatalog } from '../api';
import { STOREFRONT_ORIGIN, useCatalog, useSaver, type RegisterSave } from '../catalog';
import { Toast } from '../components/Toast';
import { DesignServicePicker } from './DesignServicesPage';
import { AddGroup } from './OptionsPage';
import { PricingEditor } from './PricingPage';
import { OptionPicker, QuantityPicker } from './ProductOptionsPage';
import { ProductDetailsForm } from './ProductsPage';
import { TurnaroundEditor } from './TurnaroundPage';

const REQUIRED_GROUPS = ['size', 'paper', 'printed_side', 'turnaround'];

const STEPS = [
  { code: 'details', label: 'Details', title: 'Product details', text: 'What customers see on the product page and in search results.' },
  { code: 'size', label: 'Size', title: 'Sizes', text: 'Tick the sizes this product comes in, or add a new one to the library.' },
  { code: 'paper', label: 'Paper', title: 'Paper', text: 'Tick the papers or stocks for this product.' },
  { code: 'printed_side', label: 'Printed sides', title: 'Printed sides', text: 'For example front only (4/0) or both sides (4/4).' },
  { code: 'quantity', label: 'Quantity', title: 'Quantities', text: 'Tick the quantities customers can order, or add a new one to the library.' },
  { code: 'turnaround', label: 'Turnaround', title: 'Turnaround', text: 'Tick your speeds, then set which quantities offer each one, with its production days and percent.' },
  { code: 'prices', label: 'Prices', title: 'Prices', text: 'One price per combination and quantity, in US dollars. Leave a cell empty if it is not sold.' },
  { code: 'addons', label: 'Add-ons', title: 'Add-ons (optional)', text: 'Tick extras such as folding or coating, each adding a percent of the price. Skip this step if there are none.' },
  { code: 'design', label: 'Design service', title: 'Design service (optional)', text: 'Tick the packages customers can buy for this product. Give one its own name if you like, and set its price.' },
  { code: 'review', label: 'Review', title: 'Review and publish', text: 'Check the product, then put it on the storefront.' },
] as const;

type StepCode = (typeof STEPS)[number]['code'];

const valuesOf = (catalog: AdminCatalog, group: string) => catalog.groups.find((g) => g.code === group)?.values.filter((v) => v.isActive) ?? [];

/** What a step still needs before the next one; null when it is complete. */
function missing(step: StepCode, catalog: AdminCatalog): string | null {
  const tiers = catalog.quantityTiers.filter((t) => t.isActive);
  switch (step) {
    case 'size':
      return valuesOf(catalog, 'size').length ? null : 'Add at least one size.';
    case 'paper':
      return valuesOf(catalog, 'paper').length ? null : 'Add at least one paper.';
    case 'printed_side':
      return valuesOf(catalog, 'printed_side').length ? null : 'Add at least one option.';
    case 'quantity':
      return tiers.length ? null : 'Add at least one quantity.';
    case 'turnaround': {
      const speeds = valuesOf(catalog, 'turnaround').map((v) => v.code);
      if (speeds.length === 0) return 'Add at least one speed.';
      const uncovered = tiers.find((t) => !catalog.turnarounds.some((c) => c.quantity === t.quantity && speeds.includes(c.value)));
      return uncovered ? `Offer a speed at quantity ${uncovered.quantity.toLocaleString('en-US')}, then save.` : null;
    }
    case 'prices': {
      const standard = (group: string) => valuesOf(catalog, group).find((v) => v.isDefault)?.code;
      const quantity = tiers.find((t) => t.isDefault)?.quantity;
      const priced = catalog.corePrices.some(
        (p) => p.size === standard('size') && p.paper === standard('paper') && p.printedSide === standard('printed_side') && p.quantity === quantity,
      );
      return priced ? null : 'Enter and save a price for the default options at the default quantity.';
    }
    default:
      return null;
  }
}

/** First step of a new product: a name is enough, the wizard asks for the rest. */
export function NewProductPage() {
  const { products, reloadProducts, selectProduct } = useCatalog();
  const navigate = useNavigate();
  const saver = useSaver();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>New product</h1>
          <p className="muted">
            Next you add its sizes, paper, printed sides, quantities, turnaround and prices, step by step. It goes on the storefront when you
            publish it in the last step.
          </p>
        </div>
      </header>
      <form
        className="card setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          let created = '';
          void saver
            .save(async () => {
              const result = await api<{ code: string }>('/admin/products', {
                method: 'POST',
                body: {
                  name: name.trim(),
                  description: description.trim() || null,
                  ...(code.trim() ? { code: code.trim() } : {}),
                  ...(copyFrom ? { copyFrom } : {}),
                },
              });
              created = result.code;
              await reloadProducts();
            }, `${name.trim()} added`)
            .then((ok) => {
              if (!ok) return;
              selectProduct(created);
              void navigate(`/products/${created}/setup/size`);
            });
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Name (shown to customers)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus placeholder="e.g. Flyers" />
          </label>
          <label className="field">
            <span>Start from</span>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Nothing (a new kind of product)</option>
              {products.map((p) => (
                <option key={p.code} value={p.code}>
                  A copy of {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>URL (optional)</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, numbers and dashes"
              maxLength={60}
              placeholder="Made from the name"
            />
          </label>
        </div>
        <label className="field">
          <span>Description (under the name on the product page)</span>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </label>
        {copyFrom && <p className="muted">Every step starts filled in from that product, and you can change anything on the way.</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving || !name.trim()}>
            Next
          </button>
          <Link className="btn btn-ghost" to="/products">
            Cancel
          </Link>
        </div>
      </form>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

/** The steps from sizes to publishing. Each one saves as it goes, so leaving and coming back loses nothing. */
export function ProductSetupPage() {
  const { code = '', step } = useParams();
  const { catalog, path, product, selectProduct } = useCatalog();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /** What the open step saves when leaving it; ticking and typing touch nothing until then. */
  const saves = useRef(new Map<string, () => Promise<boolean>>());
  const register = useCallback<RegisterSave>((key, save) => {
    saves.current.set(key, save);
    return () => saves.current.delete(key);
  }, []);

  useEffect(() => selectProduct(code), [code, selectProduct]);
  useEffect(() => setHint(null), [step]);

  if (!catalog || !product || product.code !== code || catalog.product.code !== code) return <p className="page-loading">Loading…</p>;

  const firstOpen = STEPS.findIndex((s) => missing(s.code, catalog));
  const lastReachable = firstOpen === -1 ? STEPS.length - 1 : firstOpen;
  const index = STEPS.findIndex((s) => s.code === step);
  if (index === -1 || index > lastReachable) return <Navigate to={`/products/${code}/setup/${STEPS[lastReachable]!.code}`} replace />;

  const current = STEPS[index]!;

  /** Saves the step, options first: the turnaround table needs its speeds saved. False when a part could not save. */
  async function saveStep() {
    const parts = [...saves.current].sort(([a], [b]) => Number(b.startsWith('options.')) - Number(a.startsWith('options.')));
    for (const [, save] of parts) {
      if (!(await save())) return false;
    }
    return true;
  }

  /** Leaves the step; going forward also needs it complete. */
  async function go(to: number) {
    setBusy(true);
    setHint(null);
    try {
      if (!(await saveStep())) return setHint('Check the values on this step.');
      if (to > index) {
        const needed = missing(current.code, await api<AdminCatalog>(`${path}/catalog`));
        if (needed) return setHint(needed);
      }
      void navigate(to === -1 ? '/products' : `/products/${code}/setup/${STEPS[to]!.code}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{product.name}</h1>
          <p className="muted">
            {current.title}. {current.text}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void go(-1)}>
            Finish later
          </button>
        </div>
      </header>

      <ol className="setup-steps">
        {STEPS.map((s, i) => (
          <li key={s.code}>
            <button
              type="button"
              className={`setup-step ${i < lastReachable || firstOpen === -1 ? 'setup-step-done' : ''}`}
              aria-current={i === index ? 'step' : undefined}
              disabled={i > lastReachable || busy}
              onClick={() => void go(i)}
            >
              <span className="setup-step-number">{i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      <SetupStep key={current.code} step={current.code} register={register} />

      {current.code !== 'review' && (
        <div className="setup-footer">
          {index > 0 && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void go(index - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void go(index + 1)}>
            {busy ? 'Saving…' : 'Next'}
          </button>
          {hint && <p className="form-error">{hint}</p>}
        </div>
      )}
    </div>
  );
}

function SetupStep({ step, register }: { step: StepCode; register: RegisterSave }) {
  const { catalog, library, product } = useCatalog();
  const saver = useSaver();
  const [speedCodes, setSpeedCodes] = useState<string[]>([]);
  if (!catalog || !product) return null;
  const group = library.find((g) => g.code === step);
  const addons = library.filter((g) => !g.required);
  const speeds = library.find((g) => g.code === 'turnaround');

  return (
    <>
      {step === 'details' && (
        <div className="card">
          <ProductDetailsForm product={product} saver={saver} register={register} />
        </div>
      )}
      {(step === 'size' || step === 'paper' || step === 'printed_side') && group && <OptionPicker group={group} saver={saver} register={register} />}
      {step === 'quantity' && <QuantityPicker saver={saver} register={register} />}
      {step === 'turnaround' && speeds && (
        <>
          <OptionPicker group={speeds} saver={saver} register={register} onPicked={setSpeedCodes} />
          {speedCodes.length > 0 && <TurnaroundEditor register={register} speedCodes={speedCodes} />}
        </>
      )}
      {step === 'prices' && <PricingEditor show="core" register={register} />}
      {step === 'addons' && (
        <>
          {addons.map((g) => (
            <OptionPicker key={g.code} group={g} saver={saver} register={register} title={g.label} percent />
          ))}
          <div className="tabs">
            <AddGroup saver={saver} onAdded={() => undefined} />
          </div>
        </>
      )}
      {step === 'design' && <DesignServicePicker saver={saver} register={register} />}
      {step === 'review' && <Review saver={saver} />}
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </>
  );
}

function Review({ saver }: { saver: ReturnType<typeof useSaver> }) {
  const { catalog, product, reloadProducts } = useCatalog();
  useEffect(() => void reloadProducts(), [reloadProducts]);
  if (!catalog || !product) return null;

  const labels = (group: string) => valuesOf(catalog, group).map((v) => v.label).join(', ');
  const addons = catalog.groups.filter((g) => !REQUIRED_GROUPS.includes(g.code));
  const combinations = ['size', 'paper', 'printed_side'].reduce((total, g) => total * valuesOf(catalog, g).length, 1);
  const tiers = catalog.quantityTiers.filter((t) => t.isActive);

  return (
    <>
      <div className="card">
        <dl className="setup-summary">
          <div>
            <dt>Sizes</dt>
            <dd>{labels('size')}</dd>
          </div>
          <div>
            <dt>Paper</dt>
            <dd>{labels('paper')}</dd>
          </div>
          <div>
            <dt>Printed sides</dt>
            <dd>{labels('printed_side')}</dd>
          </div>
          <div>
            <dt>Quantities</dt>
            <dd>{tiers.map((t) => t.quantity.toLocaleString('en-US')).join(', ')}</dd>
          </div>
          <div>
            <dt>Turnaround</dt>
            <dd>{labels('turnaround')}</dd>
          </div>
          <div>
            <dt>Prices</dt>
            <dd>
              {catalog.corePrices.length} of {combinations * tiers.length} set
            </dd>
          </div>
          <div>
            <dt>Add-ons</dt>
            <dd>{addons.map((g) => g.label).join(', ') || 'None'}</dd>
          </div>
          <div>
            <dt>Customers design with</dt>
            <dd>
              Their own file
              {catalog.templates.length > 0 && `, ${catalog.templates.length} templates`}
              {catalog.designServices.length > 0 && ', our design service'}
            </dd>
          </div>
        </dl>
      </div>

      {product.setupIssue && !product.isActive && <div className="banner banner-error">{product.setupIssue}</div>}

      {product.isActive ? (
        <div className="setup-footer">
          <a className="btn btn-primary" href={`${STOREFRONT_ORIGIN}/${product.code}`} target="_blank" rel="noreferrer">
            View on storefront ↗
          </a>
          <Link className="btn btn-ghost" to="/products">
            Back to products
          </Link>
          <p className="muted">{product.name} is on the storefront.</p>
        </div>
      ) : (
        <div className="setup-footer">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saver.saving || Boolean(product.setupIssue)}
            onClick={() =>
              void saver.save(async () => {
                await api(`/admin/products/${product.code}`, { method: 'PATCH', body: { isActive: true } });
                await reloadProducts();
              }, `${product.name} is on the storefront`)
            }
          >
            Publish to storefront
          </button>
          <Link className="btn btn-ghost" to="/products">
            Keep it hidden
          </Link>
        </div>
      )}
      <p className="muted">
        Optional: limit which options go together on <Link to={`/products/${product.code}/rules`}>Rules</Link>.
      </p>
    </>
  );
}
