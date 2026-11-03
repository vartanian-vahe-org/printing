import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every minute; null until mounted, because the server clock and the
 * visitor's clock may straddle the 2 PM cutoff and dates must not differ between the two renders.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
