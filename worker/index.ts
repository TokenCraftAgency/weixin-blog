import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { SyncPostInput } from '../shared/types';
import { deletePost, getPost, getPostByShortId, getPostIndex, upsertPost } from './kv';
import { passwordOk, SESSION_TTL_MS, signSession, verifySession } from './auth';

type Env = {
  Bindings: {
    BLOG_KV: KVNamespace;
    BLOG_API_TOKEN: string;
    ADMIN_PASSWORD: string;
    ASSETS: Fetcher;
  };
};

const app = new Hono<Env>();
const api = new Hono<Env>();

// 同源 SPA 调用不受 CORS 影响；白名单服务于油猴脚本（mp.weixin.qq.com）与本地联调
api.use(
  '*',
  cors({
    origin: ['https://mp.weixin.qq.com', 'http://localhost:5173'],
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// ---- 公开读接口（SPA 用） ----

api.get('/posts', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const all = await getPostIndex(c.env.BLOG_KV);
  // ?q= 按文章 id 或标题关键字过滤（包含匹配，不区分大小写）
  const filtered = q
    ? all.filter((p) => p.id.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
    : all;
  // ?limit=&offset= 分页（首页滚动加载）；不传 limit 返回全部（兼容旧客户端）
  const limit = Number(c.req.query('limit'));
  if (!Number.isFinite(limit) || limit <= 0) return c.json({ posts: filtered, total: filtered.length });
  const offset = Number(c.req.query('offset')) || 0;
  return c.json({
    posts: filtered.slice(offset, offset + limit),
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
  });
});

/** 短 ID 访问文章（分享链接 /#<shortId> 的解析端点；注册在 /posts/:id 之前） */
const SHORT_ID_RE = /^[23456789a-hjkmnp-tv-z]{6}$/;

api.get('/posts/short/:shortId', async (c) => {
  const shortId = c.req.param('shortId').toLowerCase();
  if (!SHORT_ID_RE.test(shortId)) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: '短 ID 格式不合法' } }, 400);
  }
  const post = await getPostByShortId(c.env.BLOG_KV, shortId);
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: '文章不存在' } }, 404);
  return c.json({ post });
});

api.get('/posts/:id', async (c) => {
  const post = await getPost(c.env.BLOG_KV, c.req.param('id'));
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: '文章不存在' } }, 404);
  return c.json({ post });
});

// ---- 写接口：Bearer Token ----

/** 从 Authorization 头取出 Bearer 凭证（无效时返回空串） */
function bearer(c: { req: { header(name: string): string | undefined } }): string {
  const header = c.req.header('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** 同步链路（公众号搭子/油猴脚本）：仅接受 BLOG_API_TOKEN */
const bearerAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = bearer(c);
  if (!c.env.BLOG_API_TOKEN || token !== c.env.BLOG_API_TOKEN) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: '无效或缺失的 Bearer Token' } }, 401);
  }
  await next();
};

/** 删除等管理操作：BLOG_API_TOKEN 或管理员会话令牌任一即可 */
const writeAuth: MiddlewareHandler<Env> = async (c, next) => {
  const token = bearer(c);
  if (token && c.env.BLOG_API_TOKEN && token === c.env.BLOG_API_TOKEN) {
    await next();
    return;
  }
  if (token && (await verifySession(c.env.ADMIN_PASSWORD, token))) {
    await next();
    return;
  }
  return c.json({ error: { code: 'UNAUTHORIZED', message: '无效或缺失的 Bearer Token' } }, 401);
};

// ---- 管理员登录：密码校验 + 失败锁定（IP + 浏览器指纹，5 次锁 15 分钟） ----

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_LOCK_SECONDS = 900;
/** 失败计数窗口（秒），与锁定时长一致：窗口内累计 5 次即锁 */
const LOGIN_WINDOW_SECONDS = 900;

api.post('/admin/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json({ error: { code: 'CONFIG', message: '服务端未配置 ADMIN_PASSWORD' } }, 500);
  }
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const body = await c.req.json<{ password?: string; fp?: string }>().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  // 指纹为前端生成的 sha256 hex；非法/缺失时退化为仅按 ip 计数
  const fp = typeof body?.fp === 'string' && /^[a-f0-9]{64}$/.test(body.fp) ? body.fp : 'unknown';
  const scope = `${ip}:${fp}`;
  const kv = c.env.BLOG_KV;

  // 锁定期检查（值存解锁时间戳，TTL 兜底自动清理）
  const lockKey = `login:lock:${scope}`;
  const lockedUntil = Number(await kv.get(lockKey));
  if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
    return c.json(
      { error: { code: 'LOCKED', message: '尝试次数过多，账号已锁定', retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000) } },
      429,
    );
  }

  if (!(await passwordOk(c.env.ADMIN_PASSWORD, password))) {
    const failKey = `login:fail:${scope}`;
    const fails = Number(await kv.get(failKey)) + 1;
    if (fails >= LOGIN_FAIL_LIMIT) {
      await kv.put(lockKey, String(Date.now() + LOGIN_LOCK_SECONDS * 1000), { expirationTtl: LOGIN_LOCK_SECONDS });
      await kv.delete(failKey);
      return c.json(
        { error: { code: 'LOCKED', message: '尝试次数过多，已锁定', retryAfter: LOGIN_LOCK_SECONDS } },
        429,
      );
    }
    await kv.put(failKey, String(fails), { expirationTtl: LOGIN_WINDOW_SECONDS });
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: '密码错误', remaining: LOGIN_FAIL_LIMIT - fails } },
      401,
    );
  }

  await kv.delete(`login:fail:${scope}`);
  const token = await signSession(c.env.ADMIN_PASSWORD, {
    exp: Date.now() + SESSION_TTL_MS,
    fp,
  });
  return c.json({ ok: true, token, expiresIn: Math.floor(SESSION_TTL_MS / 1000) });
});

// ---- 图片转存：解码正文/封面中的 base64 data URI → KV（img:<sha256>.<ext>） ----

const IMG_KEY_RE = /^[a-f0-9]{64}\.(png|jpe?g|gif|webp|bmp)$/;
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};
/** 单张图片解码后的字节上限（超限不转存，调用方回退 data-src 原链接） */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 解码单个 data URI 并写入 KV，返回图片 key（内容哈希，幂等去重）；失败返回 null */
async function storeDataImage(kv: KVNamespace, uri: string): Promise<string | null> {
  const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,([\s\S]+)$/i.exec(uri);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const ext = kind === 'jpeg' ? 'jpg' : kind;
  try {
    const bin = atob(m[2].replace(/\s+/g, ''));
    if (!bin.length || bin.length > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let hash = '';
    for (const b of new Uint8Array(digest)) hash += b.toString(16).padStart(2, '0');
    const key = `${hash}.${ext}`;
    await kv.put(`img:${key}`, bytes);
    return key;
  } catch {
    return null;
  }
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const DATA_SRC_RE = /(\ssrc=["'])(data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[^"']+)["']/i;

/**
 * 把正文 <img> 内嵌的 data URI 图片转存 KV 并把 src 改写为 /img/<key>。
 * 约定：内嵌方在 data-src 保留原始链接；单张失败（解码失败/超限）时 src 还原为
 * data-src，无 data-src 的标签保持不动（不让 data URI 落库）。
 */
async function extractDataImages(
  kv: KVNamespace,
  html: string,
): Promise<{ html: string; transferred: number }> {
  if (!html.includes('data:image/')) return { html, transferred: 0 };
  // 先串行处理收集替换结果，再统一替换（replace 回调无法 await）
  const tags = Array.from(new Set(html.match(IMG_TAG_RE) ?? [])).filter((t) => DATA_SRC_RE.test(t));
  const tagMap = new Map<string, string>();
  let transferred = 0;
  for (const tag of tags) {
    const uri = DATA_SRC_RE.exec(tag)![2];
    const key = await storeDataImage(kv, uri);
    if (key) {
      tagMap.set(tag, tag.replace(DATA_SRC_RE, (_m, p1: string) => `${p1}/img/${key}"`));
      transferred += 1;
    } else {
      const origin = /\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1];
      if (origin) tagMap.set(tag, tag.replace(DATA_SRC_RE, (_m, p1: string) => `${p1}${origin}"`));
    }
  }
  if (!tagMap.size) return { html, transferred: 0 };
  return { html: html.replace(IMG_TAG_RE, (t) => tagMap.get(t) ?? t), transferred };
}

/** 封面若为 data URI 同样转存；失败保留原值 */
async function extractCoverImage(kv: KVNamespace, coverUrl: string): Promise<string> {
  if (!coverUrl.startsWith('data:image/')) return coverUrl;
  const key = await storeDataImage(kv, coverUrl);
  return key ? `/img/${key}` : coverUrl;
}

const SOURCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 同步单篇（幂等 upsert，重复 PUT 同 sourceId 覆盖不产生重复） */
api.put('/posts/:sourceId', bearerAuth, async (c) => {
  const sourceId = c.req.param('sourceId');
  if (!SOURCE_ID_RE.test(sourceId)) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'sourceId 格式不合法' } }, 400);
  }
  const body = await c.req.json<SyncPostInput>().catch(() => null);
  if (!body?.title?.trim() || !body?.contentHtml?.trim()) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'title 与 contentHtml 为必填字符串' } }, 400);
  }
  // 上限含 base64 内嵌图片的体积膨胀（+33%）
  if (body.contentHtml.length > 24 * 1024 * 1024) {
    return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '正文超过 24MB 上限' } }, 413);
  }
  try {
    const imgs = await extractDataImages(c.env.BLOG_KV, body.contentHtml);
    const coverUrl = await extractCoverImage(c.env.BLOG_KV, body.coverUrl?.trim() ?? '');
    const result = await upsertPost(c.env.BLOG_KV, sourceId, {
      title: body.title.trim(),
      author: body.author?.trim() ?? '',
      digest: body.digest?.slice(0, 200) ?? '',
      contentHtml: imgs.html,
      coverUrl,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 10).map(String) : [],
      sourceCreatedAt: typeof body.sourceCreatedAt === 'number' ? body.sourceCreatedAt : Date.now(),
    });
    return c.json({ ok: true, created: result.created, post: result.summary, transferred: imgs.transferred });
  } catch (err) {
    console.error('upsertPost failed', err);
    return c.json({ error: { code: 'INTERNAL', message: '写入失败，请稍后重试' } }, 500);
  }
});

/** 删除单篇（API Token 或管理员会话；图片键可能跨文章共享，不清理） */
api.delete('/posts/:sourceId', writeAuth, async (c) => {
  const sourceId = c.req.param('sourceId');
  if (!SOURCE_ID_RE.test(sourceId)) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'sourceId 格式不合法' } }, 400);
  }
  try {
    if (!(await deletePost(c.env.BLOG_KV, sourceId))) {
      return c.json({ error: { code: 'NOT_FOUND', message: '文章不存在' } }, 404);
    }
    return c.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('deletePost failed', err);
    return c.json({ error: { code: 'INTERNAL', message: '删除失败，请稍后重试' } }, 500);
  }
});

app.route('/api', api);

// 图片公开读：内容哈希键天然不可变 → 强缓存 + KV 边缘缓存（须在 SPA 兜底之前注册）
app.get('/img/:key', async (c) => {
  const key = c.req.param('key');
  if (!IMG_KEY_RE.test(key)) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: '非法图片 key' } }, 400);
  }
  const buf = await c.env.BLOG_KV.get(`img:${key}`, { type: 'arrayBuffer', cacheTtl: 86400 });
  if (!buf) return c.json({ error: { code: 'NOT_FOUND', message: '图片不存在' } }, 404);
  return new Response(buf, {
    headers: {
      'Content-Type': MIME_BY_EXT[key.split('.').pop() ?? ''] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// 其余路径（SPA 前端路由）→ 静态资产；未命中由 not_found_handling 回退 index.html
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
