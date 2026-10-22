import type { Metadata } from 'next';
import { Configurator } from '../../components/configurator/Configurator';
import { getConfigurator, getDesignServices, getTemplates } from '../../lib/api';
import { isEnabled } from '../../lib/features';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Custom Business Cards',
  description:
    'Choose size, paper and finish for your business cards, pick a template, add your details and preview the card in 3D.',
};

const PRODUCT_CODE = 'business-cards';

export default async function BusinessCardsPage() {
  let data: Awaited<ReturnType<typeof getConfigurator>> | null = null;
  let templates: Awaited<ReturnType<typeof getTemplates>> = { templates: [], facets: [] };
  let designServices: Awaited<ReturnType<typeof getDesignServices>> = [];
  let error: string | null = null;
  try {
    [data, templates, designServices] = await Promise.all([
      getConfigurator(PRODUCT_CODE),
      getTemplates(PRODUCT_CODE),
      // The page works without the design service (e.g. an API from before it existed).
      isEnabled('design-service') ? getDesignServices(PRODUCT_CODE).catch(() => []) : [],
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className={styles.main}>
      {data ? (
        <>
          <div className={styles.intro}>
            <h1 className={styles.title}>{data.catalog.product.name}</h1>
            <p className={styles.subtitle}>Pick your options, then upload a design, use a template, or let us design it for you.</p>
          </div>
          <Configurator
            catalog={data.catalog}
            defaults={data.defaults}
            calendar={data.calendar}
            templates={templates.templates}
            facets={templates.facets}
            designServices={designServices}
          />
        </>
      ) : (
        <div className={styles.error} role="alert">
          <h1>We can’t load the product right now</h1>
          <p>Please try again in a moment.</p>
          {process.env.NODE_ENV !== 'production' && <pre>{error}</pre>}
        </div>
      )}
    </main>
  );
}
