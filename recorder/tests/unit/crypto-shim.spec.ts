import { expect, test } from '@playwright/test';
import crypto from '../../src/shims/crypto.js';

test('browser crypto shim preserves incremental hashing and binary inputs', () => {
  expect(crypto.createHash('sha1').update('a').update('bc').digest('hex'))
      .toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  expect(crypto.createHash('sha1').update(Buffer.from('abc')).digest('hex'))
      .toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  expect(crypto.createHash('md5').update('abc').digest('hex'))
      .toBe('900150983cd24fb0d6963f7d28e17f72');
});

test('browser crypto shim generates buffers suitable for recorder IDs', () => {
  expect(crypto.randomBytes(0).length).toBe(0);
  const bytes = crypto.randomBytes(16);
  expect(Buffer.isBuffer(bytes)).toBe(true);
  expect(bytes.toString('hex')).toMatch(/^[a-f0-9]{32}$/);
  expect(crypto.randomBytes(16).equals(bytes)).toBe(false);
});
