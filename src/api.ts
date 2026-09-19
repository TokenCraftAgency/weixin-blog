import type { BlogPost, BlogPostSummary, SiteAccess } from '../shared/types';

/** 首页文章列表分页页大小 */
export const POSTS_PAGE_SIZE = 10;

/** 站点设为管理员访问且凭证无效/缺失时抛出（页面据此呈现登录引导） */
export class SiteLockedError extends Error {
  constructor(message = '本站已设为管理员访问，请先登录') {
    super(message);
  }
}

/** 管理员已登录时附 Bearer 头（受限接口需要；未登录返回空对象） */
function authHeaders(): Record<string, string> {
  const session = loadToken();
  return session ? { Authorization: `Bearer ${session.value}` } : {};
}

/** 首页文章列表（按 offset 分页，滚动加载；q 为标题/id 关键字过滤）；网络/服务错误抛出，由页面展示错误态 */
export async function fetchPosts(
  offset = 0,
  limit = POSTS_PAGE_SIZE,
  q = '',
): Promise<{ posts: BlogPostSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q.trim()) params.set('q', q.trim());
  const res = await fetch(`/api/posts?${params.toString()}`, { headers: authHeaders() });
  if (res.status === 403) throw new SiteLockedError(await readErrorMessage(res));
  if (!res.ok) throw new Error(`加载文章列表失败（${res.status}）`);
  const data = (await res.json()) as {
    posts: BlogPostSummary[];
    total: number;
    hasMore: boolean;
  };
  return { posts: data.posts, total: data.total, hasMore: data.hasMore === true };
}

/** 读取接口错误体中的 message（解析失败返回空串） */
async function readErrorMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? '';
}

/** 文章详情（列表入口，按文章 id）；404 返回 null，403 抛 SiteLockedError，其余非 200 抛出 */
export async function fetchPost(id: string): Promise<BlogPost | null> {
  const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (res.status === 403) throw new SiteLockedError(await readErrorMessage(res));
  if (!res.ok) throw new Error(`加载文章失败（${res.status}）`);
  const data = (await res.json()) as { post: BlogPost };
  return data.post;
}

/** 文章详情（分享入口，按 6 位短 ID /#<shortId>）；404 返回 null，其余非 200 抛出 */
export async function fetchPostByShortId(shortId: string): Promise<BlogPost | null> {
  const res = await fetch(`/api/posts/short/${encodeURIComponent(shortId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载文章失败（${res.status}）`);
  const data = (await res.json()) as { post: BlogPost };
  return data.post;
}

// ---- 管理员会话（登录/令牌存取/删除） ----

const FP_KEY = 'blog_fp';
const TOKEN_KEY = 'blog_admin_token';

/** 登录失败错误：区分密码错误（剩余额度）与锁定（剩余秒数） */
export class AdminLoginError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAUTHORIZED' | 'LOCKED' | 'ERROR',
    readonly remaining?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * 浏览器指纹：UA + 语言 + 时区 + 屏幕尺寸 + dpr 的 SHA-256，
 * 首次计算后缓存 localStorage 保证稳定（服务端失败锁定粒度的一部分）。
 */
export async function getFingerprint(): Promise<string> {
  const cached = localStorage.getItem(FP_KEY);
  if (cached && /^[a-f0-9]{64}$/.test(cached)) return cached;
  const raw = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}`,
    String(window.devicePixelRatio || 1),
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  localStorage.setItem(FP_KEY, hex);
  return hex;
}

/** 读取本地令牌并解析 exp（无效/过期返回 null，顺手清理） */
export function loadToken(): { value: string; exp: number } | null {
  const value = localStorage.getItem(TOKEN_KEY);
  if (!value) return null;
  try {
    const payload = JSON.parse(atob(value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return { value, exp: payload.exp };
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

function notifyAdminChange(): void {
  window.dispatchEvent(new Event('blog-admin-change'));
}

/** 登录；成功存令牌并广播登录态变化，失败抛 AdminLoginError */
export async function adminLogin(password: string): Promise<void> {
  const fp = await getFingerprint();
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, fp }),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    token?: string;
    error?: { code?: string; message?: string; remaining?: number; retryAfter?: number };
  } | null;
  if (res.ok && data?.ok && data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
    notifyAdminChange();
    return;
  }
  const err = data?.error;
  if (res.status === 401) {
    throw new AdminLoginError(err?.message ?? '密码错误', 'UNAUTHORIZED', err?.remaining);
  }
  if (res.status === 429) {
    throw new AdminLoginError(err?.message ?? '尝试次数过多，已锁定', 'LOCKED', undefined, err?.retryAfter ?? 900);
  }
  throw new AdminLoginError(err?.message ?? `登录失败（${res.status}）`, 'ERROR');
}

/** 退出登录（仅清本地令牌，无状态令牌无法服务端吊销，改密码可全局失效） */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  notifyAdminChange();
}

// ---- 站点配置（管理员设置页） ----

/** 读当前访问模式（公开接口） */
export async function fetchSiteConfig(): Promise<{ access: SiteAccess }> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`加载站点配置失败（${res.status}）`);
  const data = (await res.json()) as { access: SiteAccess };
  return { access: data.access === 'admin' ? 'admin' : 'public' };
}

/** 修改访问模式（需管理员会话）；401/403 时清令牌提示重登 */
export async function updateSiteAccess(access: SiteAccess): Promise<void> {
  const session = loadToken();
  if (!session) throw new Error('登录已过期，请重新登录');
  const res = await fetch('/api/admin/config', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access }),
  });
  if (res.status === 401) {
    clearToken();
    throw new Error('登录已失效，请重新登录');
  }
  if (!res.ok) throw new Error((await readErrorMessage(res)) || `保存失败（${res.status}）`);
}

/** 删除文章（管理员会话令牌）；401 时清令牌提示重新登录 */
export async function deletePost(id: string): Promise<void> {
  const session = loadToken();
  if (!session) throw new Error('登录已过期，请重新登录');
  const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.value}` },
  });
  if (res.status === 401) {
    clearToken();
    throw new Error('登录已失效，请重新登录');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? `删除失败（${res.status}）`);
  }
}
