import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseYamlConfig, seededRandom } from '../src/index.js';

const Schema = z
  .object({ mode: z.enum(['a', 'b']).default('a'), n: z.number().default(1) })
  .strict();

describe('parseYamlConfig', () => {
  it('gives defaults for missing, empty and comment-only text', () => {
    for (const text of [undefined, '', '   ', '# only a comment\n']) {
      expect(parseYamlConfig(Schema, text)).toEqual({ mode: 'a', n: 1 });
    }
  });

  it('parses values and rejects unknown keys and bad values', () => {
    expect(parseYamlConfig(Schema, 'mode: b\nn: 3\n')).toEqual({ mode: 'b', n: 3 });
    expect(() => parseYamlConfig(Schema, 'other: 1')).toThrow();
    expect(() => parseYamlConfig(Schema, 'mode: c')).toThrow();
  });
});

describe('seededRandom', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRandom(2)()).not.toBe(xs[0]);
  });
});
