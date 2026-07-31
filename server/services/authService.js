import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'smart_gallery_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base64url = (value) => Buffer.from(value).toString('base64url');

const decodeBase32 = (value) => {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
};

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return index < 0 ? [value, ''] : [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
  })
);

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export class AuthService {
  constructor(env = process.env) {
    this.passwordHash = env.AUTH_PASSWORD_HASH || '';
    this.totpSecret = env.AUTH_TOTP_SECRET || '';
    this.sessionSecret = env.AUTH_SESSION_SECRET || '';
  }

  isConfigured() {
    return Boolean(this.passwordHash && this.totpSecret && this.sessionSecret);
  }

  async verifyPassword(password) {
    const [algorithm, cost, blockSize, parallelization, salt, expected] = this.passwordHash.split('$');
    if (algorithm !== 'scrypt' || !cost || !blockSize || !parallelization || !salt || !expected) return false;
    const derived = await scrypt(String(password || ''), Buffer.from(salt, 'base64url'), Buffer.from(expected, 'base64url').length, {
      N: Number(cost), r: Number(blockSize), p: Number(parallelization), maxmem: 64 * 1024 * 1024
    });
    return safeEqual(derived.toString('base64url'), expected);
  }

  verifyTotp(code, now = Date.now()) {
    if (!/^\d{6}$/.test(String(code || ''))) return false;
    const secret = decodeBase32(this.totpSecret);
    const currentStep = Math.floor(now / 1000 / 30);
    for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(step));
      const digest = crypto.createHmac('sha1', secret).update(counter).digest();
      const offset = digest[digest.length - 1] & 0x0f;
      const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
      if (safeEqual(String(value % 1_000_000).padStart(6, '0'), String(code))) return true;
    }
    return false;
  }

  createSession() {
    const payload = base64url(JSON.stringify({ role: 'admin', exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, nonce: crypto.randomUUID() }));
    const signature = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  getSessionFromHeaders(headers = {}) {
    if (!this.isConfigured()) return null;
    const token = parseCookies(headers.cookie || '')[COOKIE_NAME];
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return session.role === 'admin' && Number(session.exp) > Math.floor(Date.now() / 1000) ? session : null;
    } catch {
      return null;
    }
  }

  getSession(req) {
    return this.getSessionFromHeaders(req.headers);
  }

  setSessionCookie(req, res, token) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: req.secure || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/photowall',
      maxAge: SESSION_TTL_SECONDS * 1000
    });
  }

  clearSessionCookie(req, res) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: req.secure || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/photowall'
    });
  }
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
