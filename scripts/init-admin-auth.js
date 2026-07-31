import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import QRCode from 'qrcode';

const base32 = (buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let offset = 0; offset < bits.length; offset += 5) output += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  return output;
};

const readHidden = (label) => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY) return reject(new Error('请在部署机的交互终端运行初始化命令。'));
  let value = '';
  const cleanup = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.off('data', onData);
  };
  const onData = (chunk) => {
    for (const character of chunk.toString()) {
      if (character === '\r' || character === '\n') { cleanup(); process.stdout.write('\n'); return resolve(value); }
      if (character === '\u0003') { cleanup(); return reject(new Error('初始化已取消。')); }
      if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
      if (character >= ' ') value += character;
    }
  };
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onData);
});

const prompt = async () => {
  const password = await readHidden('设置管理员密码（至少 12 位，输入不会显示）： ');
  const confirmation = await readHidden('再次输入管理员密码： ');
  if (password.length < 12) throw new Error('管理员密码至少需要 12 位。');
  if (password !== confirmation) throw new Error('两次密码不一致。');
  return password;
};

const password = await prompt();
const salt = crypto.randomBytes(16);
const hash = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
const totpSecret = base32(crypto.randomBytes(20));
const sessionSecret = crypto.randomBytes(32).toString('base64url');
const passwordHash = `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
const issuer = process.env.AUTH_TOTP_ISSUER || 'Smart Gallery';
const account = process.env.AUTH_TOTP_ACCOUNT || 'admin';
const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${totpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
const envText = `AUTH_PASSWORD_HASH=${passwordHash}\nAUTH_TOTP_SECRET=${totpSecret}\nAUTH_SESSION_SECRET=${sessionSecret}\n`;

console.log('\n使用 Google Authenticator 扫描以下二维码：\n');
console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
console.log('\n若无法扫码，请手动输入密钥：', totpSecret);

if (process.argv.includes('--write-env')) {
  const envPath = path.resolve('.env');
  try { await fs.access(envPath); throw new Error('.env 已存在，为避免覆盖密钥，本次未写入。请手动合并输出内容。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(envPath, envText, { mode: 0o600 });
  console.log(`\n已写入 ${envPath}。请确认该文件不进入版本控制。`);
} else {
  console.log('\n将以下内容安全保存到部署机 .env（或改用 --write-env 自动写入）：\n');
  console.log(envText);
}
