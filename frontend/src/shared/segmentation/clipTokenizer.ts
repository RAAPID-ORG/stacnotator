/**
 * The CLIP byte-level BPE tokenizer SAM 3's text encoder was trained with,
 * reading OpenAI's `bpe_simple_vocab_16e6.txt` merges list.
 */

const START = 49406;
const END = 49407;
const MERGE_COUNT = 49152 - 256 - 2;
const PATTERN =
  /<start_of_text>|<end_of_text>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

/**
 * GPT-2's reversible byte -> printable character table, as `[byte, char]` in
 * the order the vocabulary lists them: printable bytes first, then the rest.
 */
function byteToUnicode(): Array<[number, string]> {
  const order: number[] = [];
  const ranges: Array<[number, number]> = [
    [33, 126],
    [161, 172],
    [174, 255],
  ];
  for (const [from, to] of ranges) for (let b = from; b <= to; b++) order.push(b);
  const pairs: Array<[number, string]> = order.map((b) => [b, String.fromCharCode(b)]);
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!order.includes(b)) pairs.push([b, String.fromCharCode(256 + extra++)]);
  }
  return pairs;
}

export interface ClipTokenizer {
  /** Token ids, wrapped in start/end and zero-padded (or truncated) to `length`. */
  encode(text: string, length?: number): number[];
}

export function createClipTokenizer(mergesFile: string): ClipTokenizer {
  const table = byteToUnicode();
  const chars = table.map(([, c]) => c);
  const bytes: string[] = new Array(256);
  for (const [b, c] of table) bytes[b] = c;
  const merges = mergesFile
    .split('\n')
    .slice(1, MERGE_COUNT + 1)
    .map((line) => line.split(' ') as [string, string]);
  const vocab = [...chars, ...chars.map((c) => `${c}</w>`), ...merges.map(([a, b]) => a + b)];
  const ids = new Map(vocab.map((token, i) => [token, i]));
  const ranks = new Map(merges.map(([a, b], i) => [`${a} ${b}`, i]));
  const cache = new Map<string, number[]>();
  const encoder = new TextEncoder();

  const bpe = (token: string): number[] => {
    const cached = cache.get(token);
    if (cached) return cached;
    let word = [...token];
    word[word.length - 1] += '</w>';
    while (word.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const rank = ranks.get(`${word[i]} ${word[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) break;
      const pair = word[best] + word[best + 1];
      const merged: string[] = [];
      for (let i = 0; i < word.length; i++) {
        if (i < word.length - 1 && word[i] + word[i + 1] === pair) {
          merged.push(pair);
          i++;
        } else merged.push(word[i]);
      }
      word = merged;
    }
    const result = word.map((piece) => ids.get(piece) ?? 0);
    cache.set(token, result);
    return result;
  };

  return {
    encode(text, length = 32) {
      const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
      const tokens = [START];
      for (const match of clean.match(PATTERN) ?? []) {
        const mapped = Array.from(encoder.encode(match), (b) => bytes[b]).join('');
        tokens.push(...bpe(mapped));
      }
      tokens.push(END);
      if (tokens.length > length) {
        tokens.length = length;
        tokens[length - 1] = END;
      }
      while (tokens.length < length) tokens.push(0);
      return tokens;
    },
  };
}
