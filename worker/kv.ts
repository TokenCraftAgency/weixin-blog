import type { BlogPost, BlogPostSummary, SiteAccess } from '../shared/types';

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
