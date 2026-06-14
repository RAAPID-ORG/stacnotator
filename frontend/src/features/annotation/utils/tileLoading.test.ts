import { describe, it, expect } from 'vitest';
import { crossOriginFor, isSelfHostedTiler, substituteApiKeys } from './tileLoading';

describe('substituteApiKeys', () => {
  it('substitutes {api_key} with the stored value', () => {
    const url =
      'https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key={api_key}';
    expect(substituteApiKeys(url, { api_key: 'PLtest123' })).toBe(
      'https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key=PLtest123'
    );
  });

  it('leaves OL tile coord placeholders untouched', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{z}');
    expect(result).toContain('{x}');
    expect(result).toContain('{y}');
    expect(result).toBe('https://tiles.example.com/{z}/{x}/{y}.png?api_key=abc');
  });

  it('leaves subdomain placeholder {a-c} untouched', () => {
    const url = 'https://{a-c}.tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{a-c}');
    expect(result).toBe('https://{a-c}.tiles.example.com/{z}/{x}/{y}.png?api_key=abc');
  });

  it('leaves Bing quadkey placeholder {q} untouched', () => {
    const url = 'https://tiles.example.com/a{q}.jpeg?g=1&key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{q}');
    expect(result).toBe('https://tiles.example.com/a{q}.jpeg?g=1&key=abc');
  });

  it('leaves {api_key} in place when the key store is empty', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    expect(substituteApiKeys(url, {})).toBe(url);
  });

  it('returns a URL with no placeholders unchanged regardless of key store', () => {
    const url = 'https://tiles.openstreetmap.org/{z}/{x}/{y}.png';
    expect(substituteApiKeys(url, { api_key: 'abc' })).toBe(url);
  });

  it('substitutes {api_key} when it appears multiple times', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?a={api_key}&b={api_key}';
    expect(substituteApiKeys(url, { api_key: 'VAL' })).toBe(
      'https://tiles.example.com/{z}/{x}/{y}.png?a=VAL&b=VAL'
    );
  });

  it('leaves an unrecognised placeholder in place when no matching key is stored', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?token={unknown}';
    expect(substituteApiKeys(url, {})).toBe(url);
  });
});

describe('isSelfHostedTiler / crossOriginFor', () => {
  it('treats any provider that is not "mpc"/null as one of our tilers', () => {
    expect(isSelfHostedTiler('planet')).toBe(true);
    expect(isSelfHostedTiler('external')).toBe(true);
    expect(isSelfHostedTiler('mpc')).toBe(false);
    expect(isSelfHostedTiler(null)).toBe(false);
    expect(isSelfHostedTiler(undefined)).toBe(false);
  });

  it('uses credentialed crossOrigin only for our tilers', () => {
    expect(crossOriginFor('planet')).toBe('use-credentials');
    expect(crossOriginFor('mpc')).toBe('anonymous');
    expect(crossOriginFor(null)).toBe('anonymous');
    expect(crossOriginFor(undefined)).toBe('anonymous');
  });
});
