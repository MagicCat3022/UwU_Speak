// FNV-1a, 32-bit unsigned arithmetic, UTF-8 encoding of a JSON tuple. No mutable PRNG state.
const encoder = new TextEncoder();
export function sample(seed: string, rule: string, position: number): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(JSON.stringify([seed, rule, position])))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash / 0x1_0000_0000;
}
