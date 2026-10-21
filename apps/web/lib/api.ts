import type { Catalog, ProductionCalendar, Selection } from '@printing/pricing';
import type { Template } from '@printing/templates';

export interface ConfiguratorResponse {
  catalog: Catalog;
  defaults: { selection: Selection; quantity: number };
  calendar: ProductionCalendar;
}

/** Server-side only: the API is reached on the internal Docker network. */
export async function getConfigurator(productCode: string): Promise<ConfiguratorResponse> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set');

  // No caching: admin changes to options and prices must show up immediately.
  const res = await fetch(`${apiUrl}/products/${encodeURIComponent(productCode)}/configurator`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Configurator request failed with HTTP ${res.status}`);
  return (await res.json()) as ConfiguratorResponse;
}

/** Active templates for a product (server-side only). */
export async function getTemplates(productCode: string): Promise<Template[]> {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set');
  const res = await fetch(`${apiUrl}/products/${encodeURIComponent(productCode)}/templates`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Templates request failed with HTTP ${res.status}`);
  return ((await res.json()) as { templates: Template[] }).templates;
}
