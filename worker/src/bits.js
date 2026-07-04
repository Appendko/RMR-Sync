export function orMergeBytes(a, b) {
  if (a.length !== b.length) {
    throw new Error(`orMergeBytes: length mismatch (${a.length} vs ${b.length})`);
  }
  const merged = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    merged[i] = (a[i] | b[i]) & 0xff;
  }
  return merged;
}

export function countSetBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    let v = byte;
    while (v > 0) {
      count += v & 1;
      v >>= 1;
    }
  }
  return count;
}
