/**
 * 管理员会话：无状态 HMAC 签名令牌（7 天免登录）。
 * 签名密钥由 ADMIN_PASSWORD 派生（SHA-256(password + "|session-v1")），
 * 更换 ADMIN_PASSWORD 即可让全部已签发会话立即失效。
 */

const encoder = new TextEncoder();

export interface SessionPayload {
  /** 过期时间（毫秒时间戳） */
  exp: number;
  /** 签发时绑定的浏览器指纹哈希（仅信息性，删除接口不强校验） */
  fp: string;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(password: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${password}|session-v1`));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(password: string, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(password), data);
  return new Uint8Array(sig);
}

/** 常数时间比较，避免通过响应时间逐字节猜测签名 */
function equalConstTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 签发会话令牌：base64url(JSON payload).base64url(HMAC-SHA256) */
export async function signSession(password: string, payload: SessionPayload): Promise<string> {
  const body = b64encode(encoder.encode(JSON.stringify(payload)));
  const sig = await sign(password, encoder.encode(body));
  return `${body}.${b64encode(sig)}`;
}

/** 校验令牌签名与有效期，通过返回 payload，否则返回 null */
export async function verifySession(password: string, token: string): Promise<SessionPayload | null> {
  if (!password) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const expected = await sign(password, encoder.encode(body));
    if (!equalConstTime(expected, b64decode(sig))) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64decode(body))) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 密码校验：两侧 SHA-256 摘要后常数时间比对，不直接比较明文 */
export async function passwordOk(expected: string, input: string): Promise<boolean> {
  if (!expected) return false;
  const a = await crypto.subtle.digest('SHA-256', encoder.encode(expected));
  const b = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return equalConstTime(new Uint8Array(a), new Uint8Array(b));
}
