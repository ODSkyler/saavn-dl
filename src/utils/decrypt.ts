  // Pre-computed round keys (from "38346591")
  const KEYS = new Uint32Array([
    36443656, 338827529, 170141697, 338826299,
    170272797, 875566612, 170276616, 941097494,
    153487137, 941103620, 154281006, 940128288,
    221380890, 688468270, 621941049, 688727305,
    622007300, 151861785, 890309646, 184882698,
    874054925, 50799890, 874062625, 117842443,
    805908001, 119942188, 839720978, 102894652,
    302780946, 103954180, 302782501, 338829583
  ]);

  // S-boxes
  const S1 = new Int32Array([
    0x1010400, 0, 0x10000, 0x1010404, 0x1010004, 0x10404, 0x4, 0x10000,
    0x400, 0x1010400, 0x1010404, 0x400, 0x1000404, 0x1010004, 0x1000000, 0x4,
    0x404, 0x1000400, 0x1000400, 0x10400, 0x10400, 0x1010000, 0x1010000, 0x1000404,
    0x10004, 0x1000004, 0x1000004, 0x10004, 0, 0x404, 0x10404, 0x1000000,
    0x10000, 0x1010404, 0x4, 0x1010000, 0x1010400, 0x1000000, 0x1000000, 0x400,
    0x1010004, 0x10000, 0x10400, 0x1000004, 0x400, 0x4, 0x1000404, 0x10404,
    0x1010404, 0x10004, 0x1010000, 0x1000404, 0x1000004, 0x404, 0x10404, 0x1010400,
    0x404, 0x1000400, 0x1000400, 0, 0x10004, 0x10400, 0, 0x1010004
  ]);

  const S2 = new Int32Array([
    -0x7FEF7FE0, -0x7FFF8000, 0x8000, 0x108020, 0x100000, 0x20, -0x7FEFFFE0, -0x7FFF7FE0,
    -0x7FFFFFE0, -0x7FEF7FE0, -0x7FEF8000, -0x80000000, -0x7FFF8000, 0x100000, 0x20, -0x7FEFFFE0,
    0x108000, 0x100020, -0x7FFF7FE0, 0, -0x80000000, 0x8000, 0x108020, -0x7FF00000,
    0x100020, -0x7FFFFFE0, 0, 0x108000, 0x8020, -0x7FEF8000, -0x7FF00000, 0x8020,
    0, 0x108020, -0x7FEFFFE0, 0x100000, -0x7FFF7FE0, -0x7FF00000, -0x7FEF8000, 0x8000,
    -0x7FF00000, -0x7FFF8000, 0x20, -0x7FEF7FE0, 0x108020, 0x20, 0x8000, -0x80000000,
    0x8020, -0x7FEF8000, 0x100000, -0x7FFFFFE0, 0x100020, -0x7FFF7FE0, -0x7FFFFFE0, 0x100020,
    0x108000, 0, -0x7FFF8000, 0x8020, -0x80000000, -0x7FEFFFE0, -0x7FEF7FE0, 0x108000
  ]);

  const S3 = new Int32Array([
    0x208, 0x8020200, 0, 0x8020008, 0x8000200, 0, 0x20208, 0x8000200,
    0x20008, 0x8000008, 0x8000008, 0x20000, 0x8020208, 0x20008, 0x8020000, 0x208,
    0x8000000, 0x8, 0x8020200, 0x200, 0x20200, 0x8020000, 0x8020008, 0x20208,
    0x8000208, 0x20200, 0x20000, 0x8000208, 0x8, 0x8020208, 0x200, 0x8000000,
    0x8020200, 0x8000000, 0x20008, 0x208, 0x20000, 0x8020200, 0x8000200, 0,
    0x200, 0x20008, 0x8020208, 0x8000200, 0x8000008, 0x200, 0, 0x8020008,
    0x8000208, 0x20000, 0x8000000, 0x8020208, 0x8, 0x20208, 0x20200, 0x8000008,
    0x8020000, 0x8000208, 0x208, 0x8020000, 0x20208, 0x8, 0x8020008, 0x20200
  ]);

  const S4 = new Int32Array([
    0x802001, 0x2081, 0x2081, 0x80, 0x802080, 0x800081, 0x800001, 0x2001,
    0, 0x802000, 0x802000, 0x802081, 0x81, 0, 0x800080, 0x800001,
    0x1, 0x2000, 0x800000, 0x802001, 0x80, 0x800000, 0x2001, 0x2080,
    0x800081, 0x1, 0x2080, 0x800080, 0x2000, 0x802080, 0x802081, 0x81,
    0x800080, 0x800001, 0x802000, 0x802081, 0x81, 0, 0, 0x802000,
    0x2080, 0x800080, 0x800081, 0x1, 0x802001, 0x2081, 0x2081, 0x80,
    0x802081, 0x81, 0x1, 0x2000, 0x800001, 0x2001, 0x802080, 0x800081,
    0x2001, 0x2080, 0x800000, 0x802001, 0x80, 0x800000, 0x2000, 0x802080
  ]);

  const S5 = new Int32Array([
    0x100, 0x2080100, 0x2080000, 0x42000100, 0x80000, 0x100, 0x40000000, 0x2080000,
    0x40080100, 0x80000, 0x2000100, 0x40080100, 0x42000100, 0x42080000, 0x80100, 0x40000000,
    0x2000000, 0x40080000, 0x40080000, 0, 0x40000100, 0x42080100, 0x42080100, 0x2000100,
    0x42080000, 0x40000100, 0, 0x42000000, 0x2080100, 0x2000000, 0x42000000, 0x80100,
    0x80000, 0x42000100, 0x100, 0x2000000, 0x40000000, 0x2080000, 0x42000100, 0x40080100,
    0x2000100, 0x40000000, 0x42080000, 0x2080100, 0x40080100, 0x100, 0x2000000, 0x42080000,
    0x42080100, 0x80100, 0x42000000, 0x42080100, 0x2080000, 0, 0x40080000, 0x42000000,
    0x80100, 0x2000100, 0x40000100, 0x80000, 0, 0x40080000, 0x2080100, 0x40000100
  ]);

  const S6 = new Int32Array([
    0x20000010, 0x20400000, 0x4000, 0x20404010, 0x20400000, 0x10, 0x20404010, 0x400000,
    0x20004000, 0x404010, 0x400000, 0x20000010, 0x400010, 0x20004000, 0x20000000, 0x4010,
    0, 0x400010, 0x20004010, 0x4000, 0x404000, 0x20004010, 0x10, 0x20400010,
    0x20400010, 0, 0x404010, 0x20404000, 0x4010, 0x404000, 0x20404000, 0x20000000,
    0x20004000, 0x10, 0x20400010, 0x404000, 0x20404010, 0x400000, 0x4010, 0x20000010,
    0x400000, 0x20004000, 0x20000000, 0x4010, 0x20000010, 0x20404010, 0x404000, 0x20400000,
    0x404010, 0x20404000, 0, 0x20400010, 0x10, 0x4000, 0x20400000, 0x404010,
    0x4000, 0x400010, 0x20004010, 0, 0x20404000, 0x20000000, 0x400010, 0x20004010
  ]);

  const S7 = new Int32Array([
    0x200000, 0x4200002, 0x4000802, 0, 0x800, 0x4000802, 0x200802, 0x4200800,
    0x4200802, 0x200000, 0, 0x4000002, 0x2, 0x4000000, 0x4200002, 0x802,
    0x4000800, 0x200802, 0x200002, 0x4000800, 0x4000002, 0x4200000, 0x4200800, 0x200002,
    0x4200000, 0x800, 0x802, 0x4200802, 0x200800, 0x2, 0x4000000, 0x200800,
    0x4000000, 0x200800, 0x200000, 0x4000802, 0x4000802, 0x4200002, 0x4200002, 0x2,
    0x200002, 0x4000000, 0x4000800, 0x200000, 0x4200800, 0x802, 0x200802, 0x4200800,
    0x802, 0x4000002, 0x4200802, 0x4200000, 0x200800, 0, 0x2, 0x4200802,
    0, 0x200802, 0x4200000, 0x800, 0x4000002, 0x4000800, 0x800, 0x200002
  ]);

  const S8 = new Int32Array([
    0x10001040, 0x1000, 0x40000, 0x10041040, 0x10000000, 0x10001040, 0x40, 0x10000000,
    0x40040, 0x10040000, 0x10041040, 0x41000, 0x10041000, 0x41040, 0x1000, 0x40,
    0x10040000, 0x10000040, 0x10001000, 0x1040, 0x41000, 0x40040, 0x10040040, 0x10041000,
    0x1040, 0, 0, 0x10040040, 0x10000040, 0x10001000, 0x41040, 0x40000,
    0x41040, 0x40000, 0x10041000, 0x1000, 0x40, 0x10040040, 0x1000, 0x41040,
    0x10001000, 0x40, 0x10000040, 0x10040000, 0x10040040, 0x10000000, 0x40000, 0x10001040,
    0, 0x10041040, 0x40040, 0x10000040, 0x10040000, 0x10001000, 0x10001040, 0,
    0x10041040, 0x41000, 0x41000, 0x1040, 0x1040, 0x40040, 0x10000000, 0x10041000
  ]);

  function desDecrypt(message: string): string {
    const keys = KEYS;
    const s1 = S1, s2 = S2, s3 = S3, s4 = S4;
    const s5 = S5, s6 = S6, s7 = S7, s8 = S8;

    const len = message.length;
    let result = '';
    let left: number;
    let right: number;
    let temp: number;

    for (let m = 0; m < len; m += 8) {
      left = (message.charCodeAt(m) << 24) |
             (message.charCodeAt(m + 1) << 16) |
             (message.charCodeAt(m + 2) << 8) |
             message.charCodeAt(m + 3);
      right = (message.charCodeAt(m + 4) << 24) |
              (message.charCodeAt(m + 5) << 16) |
              (message.charCodeAt(m + 6) << 8) |
              message.charCodeAt(m + 7);

      // Initial Permutation
      temp = ((left >>> 4) ^ right) & 0x0F0F0F0F;
      right ^= temp;
      left ^= (temp << 4);

      temp = ((left >>> 16) ^ right) & 0x0000FFFF;
      right ^= temp;
      left ^= (temp << 16);

      temp = ((right >>> 2) ^ left) & 0x33333333;
      left ^= temp;
      right ^= (temp << 2);

      temp = ((right >>> 8) ^ left) & 0x00FF00FF;
      left ^= temp;
      right ^= (temp << 8);

      temp = ((left >>> 1) ^ right) & 0x55555555;
      right ^= temp;
      left ^= (temp << 1);

      left = ((left << 1) | (left >>> 31));
      right = ((right << 1) | (right >>> 31));

      // 16 rounds (decryption - keys in reverse)
      for (let i = 30; i >= 0; i -= 2) {
        const right1: number = right ^ keys[i];
        const rrot: number = (right >>> 4) | (right << 28);
        const right2: number = rrot ^ keys[i + 1];

        temp = left;
        left = right;
        right = temp ^ (
          s2[(right1 >>> 24) & 63] |
          s4[(right1 >>> 16) & 63] |
          s6[(right1 >>> 8) & 63] |
          s8[right1 & 63] |
          s1[(right2 >>> 24) & 63] |
          s3[(right2 >>> 16) & 63] |
          s5[(right2 >>> 8) & 63] |
          s7[right2 & 63]
        );
      }

      // Swap left and right
      temp = left;
      left = right;
      right = temp;

      // Final Permutation (IP-1)
      left = ((left >>> 1) | (left << 31));
      right = ((right >>> 1) | (right << 31));

      temp = ((left >>> 1) ^ right) & 0x55555555;
      right ^= temp;
      left ^= (temp << 1);

      temp = ((right >>> 8) ^ left) & 0x00FF00FF;
      left ^= temp;
      right ^= (temp << 8);

      temp = ((right >>> 2) ^ left) & 0x33333333;
      left ^= temp;
      right ^= (temp << 2);

      temp = ((left >>> 16) ^ right) & 0x0000FFFF;
      right ^= temp;
      left ^= (temp << 16);

      temp = ((left >>> 4) ^ right) & 0x0F0F0F0F;
      right ^= temp;
      left ^= (temp << 4);

      result += String.fromCharCode(
        (left >>> 24),
        ((left >>> 16) & 0xFF),
        ((left >>> 8) & 0xFF),
        (left & 0xFF),
        (right >>> 24),
        ((right >>> 16) & 0xFF),
        ((right >>> 8) & 0xFF),
        (right & 0xFF)
      );
    }
    return result;
  }

/**
 * Decrypts a JioSaavn encrypted_media_url using DES ECB PKCS7
 */
export function decryptMediaUrl(encrypted: string): string {
  // Normalize the encrypted Base64 value
  let normalized = encrypted
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Remove existing padding before re-applying it
  normalized = normalized.replace(/=+$/, '');

  // Base64 length of 1 mod 4 can never be valid
  if (normalized.length % 4 === 1) {
    throw new Error('Invalid encrypted media URL encoding');
  }

  // Restore missing Base64 padding
  const padding = (4 - (normalized.length % 4)) % 4;
  normalized += '='.repeat(padding);

  const decoded = atob(normalized);
  const plain = desDecrypt(decoded);

  // DES/PKCS-style padding
  const paddingLength = plain.charCodeAt(plain.length - 1);

  if (
    paddingLength < 1 ||
    paddingLength > 8 ||
    paddingLength > plain.length
  ) {
    throw new Error('Invalid decrypted media URL padding');
  }

  return plain.slice(0, -paddingLength);
}

/**
 * Given a decrypted media URL, swap quality suffix
 * e.g. _96.mp4 → _320.mp4
 */
export function getQualityUrl(decryptedUrl: string, quality: string): string {
  // JioSaavn URLs end with _<quality>.mp4
  return decryptedUrl.replace(/_\d+\.mp4(\?.*)?$/, `_${quality}.mp4`);
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}