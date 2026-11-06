import { defaultQuantity, offeredQuantities, quote, resolveSelection, type Catalog } from '@printing/pricing';
import type { Template } from '@printing/templates';
import Link from 'next/link';
import { comingSoon, getConfigurator, getProducts, getTemplates } from '../lib/api';
import { CardArt } from '../components/home/CardArt';
import { formatCents } from '../lib/format';
import styles from './home.module.css';

export const dynamic = 'force-dynamic';

const STANDARD_CARD = { widthIn: 3.5, heightIn: 2, bleedIn: 0.125, safeIn: 0.125 };

/** Smallest quantity sold with the default options, e.g. "From $15.80 for 50 cards". */
function startingPrice(catalog: Catalog): { cents: number; quantity: number } | null {
  const quantity = offeredQuantities(catalog, resolveSelection(catalog, {}, defaultQuantity(catalog)))[0];
  if (!quantity) return null;
  const q = quote(catalog, { selection: resolveSelection(catalog, {}, quantity), quantity });
  return { cents: q.totalCents, quantity };
}


const VALUE_PROPS = [
  { title: 'Fast turnaround', text: 'Production in as little as 1 business day. Order by 2 PM Pacific.' },
  { title: 'Made in California', text: 'Printed and trimmed in our own facility, not outsourced.' },
  { title: 'Free proof', text: 'Approve a digital proof of your design before anything is printed.' },
  { title: 'Free shipping over $100', text: 'Free standard shipping to all 50 states on orders of $100 or more.' },
];

export default async function HomePage() {
  const products = await getProducts().catch(() => []);
  // The first product leads the page; the admin sets the order.
  const lead = products[0];
  const [configurators, templates] = await Promise.all([
    Promise.all(products.map((p) => getConfigurator(p.code).catch(() => null))),
    lead ? getTemplates(lead.code).then((r) => r.templates, () => [] as Template[]) : ([] as Template[]),
  ]);
  const prices = configurators.map((c) => (c ? startingPrice(c.catalog) : null));
  const catalog = configurators[0]?.catalog ?? null;
  const price = prices[0] ?? null;
  const leadHref = lead ? `/${lead.code}` : '#products';
  const papers = catalog?.groups.find((g) => g.code === 'paper')?.values ?? [];
  const hero = templates.slice(0, 3);

  return (
    <main>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Custom business cards</p>
            <h1 className={styles.heroTitle}>Business cards that feel as good as they look</h1>
            <p className={styles.heroLead}>
              Pick your paper and finish, personalize a template, and see your card in 3D before we print it in our
              California shop.
            </p>
            <div className={styles.heroActions}>
              <Link href={leadHref} className={styles.primaryButton}>
                Design your business cards
              </Link>
              <a href="#templates" className={styles.secondaryButton}>
                See templates
              </a>
            </div>
            {price && (
              <p className={styles.heroPrice}>
                From <strong>{formatCents(price.cents)}</strong> for {price.quantity} {catalog?.product.unitNamePlural}
              </p>
            )}
          </div>
          <div className={styles.heroVisual} aria-hidden="true">
            {hero.map((template, i) => (
              <CardArt
                key={template.code}
                template={template}
                geometry={STANDARD_CARD}
                side={i === 1 ? 'back' : 'front'}
                className={`${styles.heroCard} ${styles[`heroCard${i}`]}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.valueProps} aria-label="Why order with us">
        {VALUE_PROPS.map((item) => (
          <div key={item.title} className={styles.valueProp}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </div>
        ))}
      </section>

      <section className={styles.section} id="products">
        <div className={styles.sectionHead}>
          <h2>Shop our products</h2>
        </div>
        <div className={styles.categories}>
          {products.map((product, i) => {
            const from = prices[i];
            return (
              <Link key={product.code} href={`/${product.code}`} className={`${styles.category} ${styles.categoryActive}`}>
                <div className={styles.categoryImage}>
                  {templates[0] && <CardArt template={templates[0]} geometry={STANDARD_CARD} className={styles.categoryCard} />}
                </div>
                <span className={styles.categoryName}>{product.name}</span>
                {from && <span className={styles.categoryMeta}>From {formatCents(from.cents)}</span>}
              </Link>
            );
          })}
          {comingSoon(products, ['Flyers', 'Postcards', 'Stickers & Labels', 'Signs & Banners']).map((name) => (
            <div key={name} className={styles.category} aria-disabled="true">
              <div className={`${styles.categoryImage} ${styles.categoryPlaceholder}`} />
              <span className={styles.categoryName}>{name}</span>
              <span className={styles.categoryMeta}>Coming soon</span>
            </div>
          ))}
        </div>
      </section>

      {templates.length > 0 && (
        <section className={styles.section} id="templates">
          <div className={styles.sectionHead}>
            <h2>Start from a template</h2>
            <Link href={leadHref} className={styles.sectionLink}>
              Customize one →
            </Link>
          </div>
          <div className={styles.templates}>
            {templates.map((template) => (
              <Link key={template.code} href={leadHref} className={styles.template}>
                <CardArt template={template} geometry={STANDARD_CARD} className={styles.templateCard} label={`${template.name} business card template`} />
                <span className={styles.templateName}>{template.name}</span>
                {template.description && <span className={styles.templateText}>{template.description}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {papers.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Choose your paper</h2>
          </div>
          <div className={styles.papers}>
            {papers.map((paper) => (
              <div key={paper.code} className={styles.paper}>
                <span className={styles.paperThickness}>{String(paper.attributes.thickness_pt ?? '')}pt</span>
                <h3>{paper.label}</h3>
                {paper.description && <p>{paper.description}</p>}
              </div>
            ))}
          </div>
          <p className={styles.paperNote}>Matte, gloss, high gloss UV, soft touch and uncoated finishes available.</p>
        </section>
      )}

      <section className={styles.cta}>
        <div>
          <h2>Ready to order?</h2>
          <p>Choose your options, see the price instantly and preview your design in 3D.</p>
        </div>
        <Link href={leadHref} className={styles.primaryButton}>
          Get started
        </Link>
      </section>
    </main>
  );
}
