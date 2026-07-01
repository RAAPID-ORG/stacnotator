/**
 * rio-color color_formula syntax: comma-separated ops, each `<op> [bands] <args>`.
 *   gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55
 */

const OPS = {
  gamma: { bands: true, args: 1 },
  saturation: { bands: false, args: 1 },
  sigmoidal: { bands: true, args: 2 },
} as const;

type OpName = keyof typeof OPS;
const OP_NAMES = Object.keys(OPS) as OpName[];

/**
 * Insert missing commas before recognised op names and lowercase the op token.
 * Idempotent. Leaves bands / numeric args untouched.
 */
export function normalizeColorFormula(input: string): string {
  const s = input.trim();
  if (!s) return '';

  const opPattern = new RegExp(`\\b(${OP_NAMES.join('|')})\\b`, 'gi');
  const matches = [...s.matchAll(opPattern)];
  if (matches.length === 0) return s;

  const parts: string[] = [];
  matches.forEach((m, i) => {
    const start = m.index!;
    const end = matches[i + 1]?.index ?? s.length;
    // Strip any trailing comma + whitespace; we'll re-join with `, `.
    const segment = s
      .slice(start, end)
      .replace(/[,\s]+$/, '')
      .trim();
    const [op, ...rest] = segment.split(/\s+/);
    parts.push([op.toLowerCase(), ...rest].join(' '));
  });
  return parts.join(', ');
}

export function validateColorFormula(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  const ops = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (ops.length === 0) return null;

  for (const op of ops) {
    const tokens = op.split(/\s+/);
    const name = tokens[0]?.toLowerCase() as OpName;
    if (!OP_NAMES.includes(name)) {
      return `Unknown operation: "${tokens[0]}". Supported: ${OP_NAMES.join(', ')}.`;
    }
    const sig = OPS[name];
    const expected = (sig.bands ? 1 : 0) + sig.args;
    const got = tokens.length - 1;
    if (got !== expected) {
      const bandsHint = sig.bands ? '<bands> ' : '';
      return `"${name}" expects ${bandsHint}${sig.args} arg${sig.args > 1 ? 's' : ''} (got ${got}).`;
    }
    if (sig.bands && !/^[RGBrgb]+$/.test(tokens[1])) {
      return `"${name}" bands must be a combo of R/G/B (got "${tokens[1]}").`;
    }
    for (let i = sig.bands ? 2 : 1; i < tokens.length; i++) {
      if (!Number.isFinite(Number(tokens[i]))) {
        return `"${name}" arg ${i} must be a number (got "${tokens[i]}").`;
      }
    }
  }
  return null;
}
