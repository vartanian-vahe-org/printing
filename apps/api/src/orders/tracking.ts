/** Public tracking pages of the carriers the shop is likely to use (open issue S1). */
const TRACKING_URLS: Record<string, (n: string) => string> = {
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
};

/** Carrier tracking link, or null for carriers without a known page. */
export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const build = TRACKING_URLS[carrier.trim().toLowerCase()];
  return build ? build(encodeURIComponent(trackingNumber.trim())) : null;
}
