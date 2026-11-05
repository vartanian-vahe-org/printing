/** Group codes the engine needs to know about. All other groups are generic add-ons. */
export const SIZE_GROUP = 'size';
export const PAPER_GROUP = 'paper';
export const PRINTED_SIDE_GROUP = 'printed_side';

/**
 * The options that make the product, in the order the customer narrows them down. Each combination
 * has a set price per quantity (Catalog.corePrices); every other option is added on top of it.
 */
export const CORE_GROUPS = [SIZE_GROUP, PAPER_GROUP, PRINTED_SIDE_GROUP] as const;

/**
 * Turnaround (production speed). Its days and price come from the product's quantity × speed table
 * (Catalog.turnarounds), and a speed can be left out at some quantities.
 */
export const TURNAROUND_GROUP = 'turnaround';
