import i18n from '~/shared/i18n';
import { colorFormulaOps } from '~/shared/imagery/colorAdjust';

const t = i18n.getFixedT(null, 'imagery');

/**
 * rio-color color_formula syntax: ops, each `<op> [bands] <args>`, with optional
 * commas between them and op names in any case.
 *   gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55
 *   Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35
 */

const OPS = {
  gamma: { bands: true, args: 1 },
  saturation: { bands: false, args: 1 },
  sigmoidal: { bands: true, args: 2 },
} as const;

type OpName = keyof typeof OPS;
const OP_NAMES = Object.keys(OPS) as OpName[];

/** The formula written the way the editors save it: lowercase op names, separated
 *  by commas. Idempotent; bands and numeric args are left as they are. */
export function normalizeColorFormula(input: string): string {
  return colorFormulaOps(input)
    .map((op) => op.join(' '))
    .join(', ');
}

export function validateColorFormula(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  for (const tokens of colorFormulaOps(s)) {
    const name = tokens[0]?.toLowerCase() as OpName;
    if (!OP_NAMES.includes(name)) {
      return t('colorFormula.unknownOp', {
        op: tokens[0],
        supported: OP_NAMES.join(', '),
      });
    }
    const sig = OPS[name];
    const expected = (sig.bands ? 1 : 0) + sig.args;
    const got = tokens.length - 1;
    if (got !== expected) {
      const bandsHint = sig.bands ? '<bands> ' : '';
      return t('colorFormula.argCount', {
        name,
        bands: bandsHint,
        count: sig.args,
        got,
      });
    }
    if (sig.bands && !/^[RGBrgb]+$/.test(tokens[1])) {
      return t('colorFormula.bands', { name, got: tokens[1] });
    }
    for (let i = sig.bands ? 2 : 1; i < tokens.length; i++) {
      if (!Number.isFinite(Number(tokens[i]))) {
        return t('colorFormula.notNumber', { name, index: i, got: tokens[i] });
      }
    }
  }
  return null;
}
