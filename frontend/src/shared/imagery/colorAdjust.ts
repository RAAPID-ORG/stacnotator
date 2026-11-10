/** The slider form of a rio-color `color_formula`: one gamma, sigmoidal contrast and
 *  saturation over all of RGB. */
export interface ColorAdjust {
  gamma: number;
  contrast: number;
  midpoint: number;
  saturation: number;
}

export const NEUTRAL_ADJUST: ColorAdjust = { gamma: 1, contrast: 0, midpoint: 0.5, saturation: 1 };

const OP_NAMES = ['gamma', 'sigmoidal', 'saturation'];

/** A formula's operations, each `[op, ...args]`, read the way rio-color reads them:
 *  commas are optional and an op name, in any case, starts the next operation. */
export function colorFormulaOps(formula: string | null | undefined): string[][] {
  const ops: string[][] = [];
  for (const token of (formula ?? '').replace(/,/g, ' ').split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (OP_NAMES.includes(lower)) ops.push([lower]);
    else if (!ops.length) ops.push([token]);
    else ops[ops.length - 1].push(token);
  }
  return ops;
}

type Slot = 'gamma' | 'sigmoidal' | 'saturation';

const isRgb = (bands: string | undefined) =>
  !!bands && [...'RGB'].every((band) => bands.toUpperCase().includes(band));

/** Which slider an operation is, when it is one: the sliders act on all of RGB. */
function slotOf(op: string[]): Slot | null {
  const [name, ...args] = op;
  if (name === 'gamma' && args.length === 2 && isRgb(args[0])) return 'gamma';
  if (name === 'sigmoidal' && args.length === 3 && isRgb(args[0])) return 'sigmoidal';
  if (name === 'saturation' && args.length === 1) return 'saturation';
  return null;
}

const finite = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value != null && Number.isFinite(n) ? n : fallback;
};

/** The sliders' positions in a formula: the first RGB gamma, RGB sigmoidal and
 *  saturation. Operations they cannot show are left out. */
export function parseColorFormula(formula: string | null | undefined): ColorAdjust {
  const adjust = { ...NEUTRAL_ADJUST };
  const seen = new Set<Slot>();
  for (const op of colorFormulaOps(formula)) {
    const slot = slotOf(op);
    if (!slot || seen.has(slot)) continue;
    seen.add(slot);
    if (slot === 'gamma') adjust.gamma = finite(op[2], 1);
    if (slot === 'sigmoidal') {
      adjust.contrast = finite(op[2], 0);
      adjust.midpoint = finite(op[3], 0.5);
    }
    if (slot === 'saturation') adjust.saturation = finite(op[1], 1);
  }
  return adjust;
}

const round = (value: number) => String(Math.round(value * 100) / 100);

function sliderOp(slot: Slot, op: string[] | undefined, adjust: ColorAdjust): string[] | null {
  const bands = op?.[1] ?? 'RGB';
  if (slot === 'gamma') return adjust.gamma === 1 ? null : ['gamma', bands, round(adjust.gamma)];
  if (slot === 'saturation') {
    return adjust.saturation === 1 ? null : ['saturation', round(adjust.saturation)];
  }
  return adjust.contrast > 0
    ? ['sigmoidal', bands, round(adjust.contrast), round(adjust.midpoint)]
    : null;
}

/** The formula with the sliders set to `adjust`. Each slider rewrites its own
 *  operation where it stands, since rio-color applies them in order; anything else
 *  in the formula is kept. None when nothing is left, so the visualization draws as
 *  if untouched. */
export function withColorAdjust(
  formula: string | null | undefined,
  adjust: ColorAdjust
): string | null {
  const seen = new Set<Slot>();
  const ops: string[][] = [];
  for (const op of colorFormulaOps(formula)) {
    const slot = slotOf(op);
    if (!slot || seen.has(slot)) ops.push(op);
    else {
      seen.add(slot);
      const next = sliderOp(slot, op, adjust);
      if (next) ops.push(next);
    }
  }
  for (const slot of ['gamma', 'sigmoidal', 'saturation'] as const) {
    const next = seen.has(slot) ? null : sliderOp(slot, undefined, adjust);
    if (next) ops.push(next);
  }
  return ops.length ? ops.map((op) => op.join(' ')).join(', ') : null;
}

export function parseRescale(rescale: string | null | undefined): [number, number] | null {
  const parts = (rescale ?? '').split(',').map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) && rescale?.trim()
    ? [parts[0], parts[1]]
    : null;
}
