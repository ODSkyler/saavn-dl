/**
 * Parity tests for the server decrypt port.
 * Run with: node --test server/downloads/decrypt.test.js
 *
 * Uses Node's built-in test runner (no extra dependency). The decryption test
 * builds a known ciphertext with the same DES-ECB key the client uses and asserts
 * decryptMediaUrl inverts it exactly — proving byte-for-byte parity with the DES
 * scheme in src/utils/decrypt.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { decryptMediaUrl, getQualityUrl, sanitizeFilename } from './decrypt.js';

const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

/** Encrypt a plaintext URL the same way JioSaavn does, to build a test vector. */
function encryptMediaUrl(plaintext) {
  const encrypted = CryptoJS.DES.encrypt(plaintext, DES_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString(); // base64
}

test('decryptMediaUrl inverts DES-ECB PKCS7 encryption', () => {
  const original = 'https://aac.saavncdn.com/123/abcdef0123456789_96.mp4';
  const encrypted = encryptMediaUrl(original);
  assert.equal(decryptMediaUrl(encrypted), original);
});

test('decryptMediaUrl tolerates unpadded base64 input', () => {
  const original = 'https://aac.saavncdn.com/999/deadbeef_160.mp4';
  const encrypted = encryptMediaUrl(original).replace(/=+$/, ''); // strip padding
  assert.equal(decryptMediaUrl(encrypted), original);
});

test('getQualityUrl swaps the quality suffix', () => {
  assert.equal(
    getQualityUrl('https://aac.saavncdn.com/x/song_96.mp4', '320'),
    'https://aac.saavncdn.com/x/song_320.mp4',
  );
  assert.equal(
    getQualityUrl('https://aac.saavncdn.com/x/song_12.mp4?foo=bar', '160'),
    'https://aac.saavncdn.com/x/song_160.mp4',
  );
});

test('sanitizeFilename strips filesystem-unsafe characters', () => {
  assert.equal(sanitizeFilename('AC/DC: Back?In*Black'), 'AC-DC- Back-In-Black');
});
