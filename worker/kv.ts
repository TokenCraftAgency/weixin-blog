import type { BlogPost, BlogPostSummary, GateConfig, LoginLogEntry, SiteAccess } from '../shared/types';

/** 列表索引键（KV 无范围查询，用单个索引数组键承载列表） */
const INDEX_KEY = 'index:posts';

/** 站点配置键（访问模式等管理员设置） */
const SITE_CONFIG_KEY = 'config:site';

/** 读站点访问模式；未配置时默认公开 */
export async function getSiteAccess(kv: KVNamespace): Promise<SiteAccess> {
  return (await kv.get<string>(SITE_CONFIG_KEY)) === 'admin' ? 'admin' : 'public';
}

export async function setSiteAccess(kv: KVNamespace, access: SiteAccess): Promise<void> {
  await kv.put(SITE_CONFIG_KEY, access);
}

/** 门禁参数键与登录日志键 */
const GATE_CONFIG_KEY = 'config:gate';
const LOGIN_LOG_KEY = 'log:login';
/** 日志保留条数上限（线性追加读写，个人博客量级足够） */
const LOGIN_LOG_MAX = 200;

export const DEFAULT_GATE: GateConfig = { failLimit: 5, lockMinutes: 15 };

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** 读门禁参数；未配置/非法值回落默认（failLimit 1-20，lockMinutes 1-1440） */
export async function getGateConfig(kv: KVNamespace): Promise<GateConfig> {
  const raw = await kv.get<Partial<GateConfig>>(GATE_CONFIG_KEY, 'json');
  return {
    failLimit: clampInt(raw?.failLimit, 1, 20, DEFAULT_GATE.failLimit),
    lockMinutes: clampInt(raw?.lockMinutes, 1, 1440, DEFAULT_GATE.lockMinutes),
  };
}

export async function setGateConfig(kv: KVNamespace, cfg: GateConfig): Promise<void> {
  await kv.put(GATE_CONFIG_KEY, JSON.stringify(cfg));
}

/** 追加登录日志（最新在前，截断保留 200 条） */
export async function appendLoginLog(kv: KVNamespace, entry: LoginLogEntry): Promise<void> {
  const list = (await kv.get<LoginLogEntry[]>(LOGIN_LOG_KEY, 'json')) ?? [];
  list.unshift(entry);
  await kv.put(LOGIN_LOG_KEY, JSON.stringify(list.slice(0, LOGIN_LOG_MAX)));
}

export async function getLoginLogs(kv: KVNamespace): Promise<LoginLogEntry[]> {
  const raw = await kv.get<LoginLogEntry[]>(LOGIN_LOG_KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

const postKey = (id: string) => `post:${id}`;
const shortKey = (sid: string) => `short:${sid}`;

/** 短 ID 字符集：去除易混字符 0/o/1/i/l */
const SHORT_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const SHORT_LEN = 6;

/** 密码学随机生成 6 位短 ID */
function randomShortId(): string {
  const bytes = new Uint8Array(SHORT_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += SHORT_ALPHABET[b % SHORT_ALPHABET.length];
  return s;
}

/** 碰撞时重试生成唯一短 ID（映射键 + 索引双重校验） */
async function genUniqueShortId(kv: KVNamespace): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const sid = randomShortId();
    if (!(await kv.get(shortKey(sid)))) return sid;
  }
  throw new Error('shortId 生成失败：多次碰撞');
}

export async function getPostIndex(kv: KVNamespace): Promise<BlogPostSummary[]> {
  const raw = await kv.get<BlogPostSummary[]>(INDEX_KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

export async function getPost(kv: KVNamespace, id: string): Promise<BlogPost | null> {
  return (await kv.get<BlogPost>(postKey(id), 'json')) ?? null;
}

/** 短 ID → 内部 sourceId（不存在返回 null） */
export async function resolveShortId(kv: KVNamespace, shortId: string): Promise<string | null> {
  return (await kv.get<string>(shortKey(shortId))) ?? null;
}

/** 按短 ID 读文章本体 */
export async function getPostByShortId(kv: KVNamespace, shortId: string): Promise<BlogPost | null> {
  const id = await resolveShortId(kv, shortId);
  if (!id) return null;
  return getPost(kv, id);
}

export interface UpsertInput {
  title: string;
  author: string;
  digest: string;
  contentHtml: string;
  coverUrl: string;
  tags: string[];
  sourceCreatedAt: number;
}

/**
 * 幂等 upsert：同 sourceId 覆盖同键，首次收录时间（publishedAt）保留。
 * 先写本体再读改写索引——双写非原子，索引写失败时详情页仍可用，
 * 且该篇下次同步会修复索引（自愈）。
 */
export async function upsertPost(
  kv: KVNamespace,
  sourceId: string,
  input: UpsertInput,
): Promise<{ created: boolean; summary: BlogPostSummary }> {
  const existing = await getPost(kv, sourceId);
  const now = Date.now();
  // 首次收录生成短 ID；重复同步保留原有短 ID（幂等）
  const shortId = existing?.shortId || (await genUniqueShortId(kv));
  const post: BlogPost = {
    id: sourceId,
    shortId,
    title: input.title,
    author: input.author,
    digest: input.digest,
    contentHtml: input.contentHtml,
    coverUrl: input.coverUrl,
    tags: input.tags,
    createdAt: input.sourceCreatedAt,
    publishedAt: existing?.publishedAt ?? now,
    syncedAt: now,
  };
  await kv.put(postKey(sourceId), JSON.stringify(post));
  if (!existing) await kv.put(shortKey(shortId), sourceId);
  const summary: BlogPostSummary = {
    id: post.id,
    shortId: post.shortId,
    title: post.title,
    digest: post.digest,
    coverUrl: post.coverUrl,
    tags: post.tags,
    createdAt: post.createdAt,
    publishedAt: post.publishedAt,
    syncedAt: post.syncedAt,
  };
  const next = [summary, ...(await getPostIndex(kv)).filter((s) => s.id !== sourceId)].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  await kv.put(INDEX_KEY, JSON.stringify(next));
  return { created: !existing, summary };
}

/**
 * 删除文章：本体与索引条目一并移除，返回是否存在。
 * 图片以内容哈希为键、可能被多篇文章共享，不做清理。
 */
export async function deletePost(kv: KVNamespace, sourceId: string): Promise<boolean> {
  const existing = await getPost(kv, sourceId);
  if (!existing) return false;
  await kv.delete(postKey(sourceId));
  if (existing.shortId) await kv.delete(shortKey(existing.shortId));
  await kv.put(
    INDEX_KEY,
    JSON.stringify((await getPostIndex(kv)).filter((s) => s.id !== sourceId)),
  );
  return true;
}
