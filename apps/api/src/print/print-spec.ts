import type { Catalog, Quote } from '@printing/pricing';
import type { CardGeometry, Template, TemplateLayout } from '@printing/templates';

/** What happens on the back of the card (the `back` attribute of the printed_side option). */
export type BackMode = 'separate' | 'blank' | 'same_as_front';

/** Everything the print file needs, frozen on the order item at checkout. */
export interface PrintSpec {
  version: 1;
  geometry: CardGeometry;
  backMode: BackMode;
  /** Template designs only: the layout as it was when the customer ordered. */
  template: { code: string; name: string; layout: TemplateLayout } | null;
}

export function backModeOf(catalog: Catalog, selection: Record<string, string>): BackMode {
  const value = catalog.groups.find((g) => g.code === 'printed_side')?.values.find((v) => v.code === selection.printed_side);
  const back = value?.attributes.back;
  return back === 'blank' || back === 'same_as_front' ? back : 'separate';
}

export function buildPrintSpec(catalog: Catalog, quote: Quote, template: Template | null): PrintSpec {
  const { widthIn, heightIn, bleedIn, safeIn } = quote.size;
  return {
    version: 1,
    geometry: { widthIn, heightIn, bleedIn, safeIn },
    backMode: backModeOf(catalog, quote.selection),
    template: template ? { code: template.code, name: template.name, layout: template.layout } : null,
  };
}
