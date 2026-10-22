import { describe, expect, it } from 'vitest';
import { resources } from './resources';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const keysOf = (value: object, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? keysOf(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );

const baseKeys = (value: object) =>
  [...new Set(keysOf(value).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort();

describe.each(Object.keys(resources.en))('the %s namespace', (ns) => {
  const en = resources.en[ns as keyof typeof resources.en];
  const es = resources.es[ns as keyof typeof resources.es];

  it('has a Spanish translation for every English string', () => {
    expect(baseKeys(es)).toEqual(baseKeys(en));
  });

  it('gives every Spanish plural the forms Spanish needs', () => {
    const esKeys = keysOf(es);
    const plurals = esKeys.filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4));
    for (const key of plurals) {
      expect(esKeys).toEqual(expect.arrayContaining([`${key}_many`, `${key}_other`]));
    }
  });
});
