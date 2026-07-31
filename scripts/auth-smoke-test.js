import assert from 'assert/strict';
import crypto from 'crypto';
import { AuthService } from '../server/services/authService.js';

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value));
});

const totpCode = (secret, now = Date.now()) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1_000_000).padStart(6, '0');
};

const salt = crypto.randomBytes(16);
const hash = await scrypt('correct horse battery staple', salt);
const service = new AuthService({
  AUTH_PASSWORD_HASH: ['scrypt', '16384', '8', '1', salt.toString('base64url'), hash.toString('base64url')].join('$'),
  AUTH_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  AUTH_SESSION_SECRET: crypto.randomBytes(32).toString('base64url')
});

assert.equal(service.isConfigured(), true);
assert.equal(await service.verifyPassword('correct horse battery staple'), true);
assert.equal(await service.verifyPassword('incorrect password'), false);
assert.equal(service.verifyTotp(totpCode('JBSWY3DPEHPK3PXP')), true);
assert.equal(service.verifyTotp('000000'), false);

const token = service.createSession();
assert.ok(service.getSessionFromHeaders({ cookie: `smart_gallery_session=${token}` }));
assert.equal(service.getSessionFromHeaders({ cookie: `smart_gallery_session=${token}x` }), null);
console.log('Authentication smoke test passed.');
