import { useEffect, useState } from 'react';

/** Touch-only devices (phones/tablets), regardless of orientation. Mirrors
 *  the `mobile:` Tailwind variant in app.css so JS and CSS stay in sync. */
export const MOBILE_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';

export const isMobileNow = () => matchMedia(MOBILE_MEDIA_QUERY).matches;

/** Reactive version of {@link isMobileNow} for use in components. */
export const useIsMobile = (query = MOBILE_MEDIA_QUERY) => {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);

  useEffect(() => {
    const mql = matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
};
