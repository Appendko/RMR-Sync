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

// Sets a single item id's bit in a byte array using the same packing
// convention as checksSeen/mergedItems/addrItems: byte Math.floor(id/8),
// bit (id % 8). Mutates `bytes` in place.
export function setBit(bytes, id) {
  const byteIndex = Math.floor(id / 8);
  const mask = 1 << (id % 8);
  bytes[byteIndex] = (bytes[byteIndex] | mask) & 0xff;
}
