import type { Catalog, ProductionCalendar, Selection } from '@printing/pricing';
import type { DesignServiceTier, Template, TemplateFacet } from '@printing/templates';

export interface ConfiguratorResponse {
  catalog: Catalog;
  defaults: { selection: Selection; quantity: number };
  calendar: ProductionCalendar;
}

/**
 * Headers for server-side calls: with the API on another host (EC2) the shared secret marks them as
 * the storefront's own server, so they are not counted against a visitor's rate limit.
 */
function serverHeaders(): HeadersInit {
  const secret = process.env.API_PROXY_SECRET;
  return secret ? { 'x-proxy-secret': secret } : {};
}

/** Server-side only: the API is reached on the internal Docker network (or its public URL from Vercel). */
export async function getConfigurator(productCode: string): Promise<ConfiguratorResponse> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set');

  // No caching: admin changes to options and prices must show up immediately.
  const res = await fetch(`${apiUrl}/products/${encodeURIComponent(productCode)}/configurator`, {
    cache: 'no-store',
    headers: serverHeaders(),
  });
  if (!res.ok) throw new Error(`Configurator request failed with HTTP ${res.status}`);
  return (await res.json()) as ConfiguratorResponse;
}

/** Active templates for a product and the filters for them (server-side only). */
export async function getTemplates(productCode: string): Promise<{ templates: Template[]; facets: TemplateFacet[] }> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set');
  const res = await fetch(`${apiUrl}/products/${encodeURIComponent(productCode)}/templates`, { cache: 'no-store', headers: serverHeaders() });
  if (!res.ok) throw new Error(`Templates request failed with HTTP ${res.status}`);
  const body = (await res.json()) as { templates: Template[]; facets?: TemplateFacet[] };
  return { templates: body.templates, facets: body.facets ?? [] };
}

/** "Let us design it for you" packages of a product (server-side only). */
export async function getDesignServices(productCode: string): Promise<DesignServiceTier[]> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set');
  const res = await fetch(`${apiUrl}/products/${encodeURIComponent(productCode)}/design-services`, { cache: 'no-store', headers: serverHeaders() });
  if (!res.ok) throw new Error(`Design services request failed with HTTP ${res.status}`);
  return ((await res.json()) as { tiers: DesignServiceTier[] }).tiers;
}
