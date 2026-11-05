import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Configurator } from '../../components/configurator/Configurator';
import { getConfigurator, getDesignServices, getProducts, getTemplates } from '../../lib/api';
import { isEnabled } from '../../lib/features';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ product: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product: code } = await params;
  const product = (await getProducts().catch(() => [])).find((p) => p.code === code);
  if (!product) return {};
  return { title: product.seoTitle ?? product.name, description: product.seoDescription ?? product.description ?? undefined };
}

export default async function ProductPage({ params }: Props) {
  const { product: code } = await params;
  let products: Awaited<ReturnType<typeof getProducts>> | null = null;
  let data: Awaited<ReturnType<typeof getConfigurator>> | null = null;
  let templates: Awaited<ReturnType<typeof getTemplates>> = { templates: [], facets: [] };
  let designServices: Awaited<ReturnType<typeof getDesignServices>> = [];
  let error: string | null = null;
  try {
    products = await getProducts();
    if (products.some((p) => p.code === code)) {
      [data, templates, designServices] = await Promise.all([
        getConfigurator(code),
        getTemplates(code),
        // The page works without the design service (e.g. an API from before it existed).
        isEnabled('design-service') ? getDesignServices(code).catch(() => []) : [],
      ]);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const product = products?.find((p) => p.code === code);
  if (products && !product) notFound();

  return (
    <main className={styles.main}>
      {data ? (
        <>
          <div className={styles.intro}>
            <h1 className={styles.title}>{data.catalog.product.name}</h1>
            {product?.description && <p className={styles.subtitle}>{product.description}</p>}
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
