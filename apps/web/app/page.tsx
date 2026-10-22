import { quote, resolveSelection, sortedTiers, type Catalog } from '@printing/pricing';
import type { Template } from '@printing/templates';
import Link from 'next/link';
import { getConfigurator, getTemplates } from '../lib/api';
import { CardArt } from '../components/home/CardArt';
import { formatCents } from '../lib/format';
import styles from './home.module.css';

export const dynamic = 'force-dynamic';

const PRODUCT_CODE = 'business-cards';
const STANDARD_CARD = { widthIn: 3.5, heightIn: 2, bleedIn: 0.125, safeIn: 0.125 };

/** Cheapest tier with the default options, e.g. "From $15.80 for 50 cards". */
function startingPrice(catalog: Catalog): { cents: number; quantity: number } | null {
  const tier = sortedTiers(catalog)[0];
  if (!tier) return null;
  const q = quote(catalog, { selection: resolveSelection(catalog, {}), quantity: tier.quantity });
  return { cents: q.totalCents, quantity: tier.quantity };
}


const VALUE_PROPS = [
  { title: 'Fast turnaround', text: 'Production in as little as 1 business day. Order by 2 PM Pacific.' },
  { title: 'Made in California', text: 'Printed and trimmed in our own facility, not outsourced.' },
  { title: 'Free proof', text: 'Approve a digital proof of your card before anything is printed.' },
  { title: 'Free shipping over $100', text: 'Free standard shipping to all 50 states on orders of $100 or more.' },
];

const COMING_SOON = ['Flyers', 'Postcards', 'Stickers & Labels', 'Signs & Banners'];

export default async function HomePage() {
  const [configurator, templates] = await Promise.all([
    getConfigurator(PRODUCT_CODE).catch(() => null),
    getTemplates(PRODUCT_CODE).then((r) => r.templates, () => [] as Template[]),
  ]);
  const catalog = configurator?.catalog ?? null;
  const price = catalog ? startingPrice(catalog) : null;
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
              <Link href="/business-cards" className={styles.primaryButton}>
                Design your business cards
              </Link>
              <a href="#templates" className={styles.secondaryButton}>
                See templates
              </a>
            </div>
            {price && (
              <p className={styles.heroPrice}>
                From <strong>{formatCents(price.cents)}</strong> for {price.quantity} cards
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Shop by category</h2>
        </div>
        <div className={styles.categories}>
          <Link href="/business-cards" className={`${styles.category} ${styles.categoryActive}`}>
            <div className={styles.categoryImage}>
              {templates[0] && <CardArt template={templates[0]} geometry={STANDARD_CARD} className={styles.categoryCard} />}
            </div>
            <span className={styles.categoryName}>Business Cards</span>
            {price && <span className={styles.categoryMeta}>From {formatCents(price.cents)}</span>}
          </Link>
          {COMING_SOON.map((name) => (
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
            <Link href="/business-cards" className={styles.sectionLink}>
              Customize one →
            </Link>
          </div>
          <div className={styles.templates}>
            {templates.map((template) => (
              <Link key={template.code} href="/business-cards" className={styles.template}>
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
          <h2>Ready to make your cards?</h2>
          <p>Choose your options, see the price instantly and preview your design in 3D.</p>
        </div>
        <Link href="/business-cards" className={styles.primaryButton}>
          Order business cards
        </Link>
      </section>
    </main>
  );
}
