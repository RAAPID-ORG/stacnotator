import { describe, expect, it } from 'vitest';
import { createClipTokenizer } from './clipTokenizer';

// A merges file whose first line is the header CLIP skips.
const MERGES = ['#version: 0.2', 'r o', 'ro o', 'roo f</w>'].join('\n');
const tokenizer = createClipTokenizer(MERGES);
// 512 byte tokens, then the merges in order.
const ROOF = 512 + 2;
const F_END = 256 + ('f'.charCodeAt(0) - 33);

describe('clip tokenizer', () => {
  it('merges by rank, wraps in start/end and pads to the context length', () => {
    expect(tokenizer.encode('Roof')).toEqual([49406, ROOF, 49407, ...new Array(29).fill(0)]);
  });

  it('falls back to byte tokens for words without merges', () => {
    expect(tokenizer.encode('f', 4)).toEqual([49406, F_END, 49407, 0]);
  });

  it('truncates long prompts but keeps the end token', () => {
    const ids = tokenizer.encode('roof roof roof roof', 4);
    expect(ids).toEqual([49406, ROOF, ROOF, 49407]);
  });
});
