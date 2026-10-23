import i18n from '~/shared/i18n';

if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>).window = globalThis;
}

// jsdom ships no matchMedia, which the responsive hooks rely on.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Component tests assert on the English copy, whatever language the runner reports.
i18n.changeLanguage('en');
