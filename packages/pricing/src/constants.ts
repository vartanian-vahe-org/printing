/** Group codes the engine needs to know about. All other groups are generic. */
export const SIZE_GROUP = 'size';

/** Size value code that takes customer-entered width/height. */
export const CUSTOM_SIZE_VALUE = 'custom';

/**
 * Turnaround (production speed). Its days and price come from the product's quantity × speed table
 * (Catalog.turnarounds), not from upcharges, and a speed can be left out at some quantities.
 */
export const TURNAROUND_GROUP = 'turnaround';
