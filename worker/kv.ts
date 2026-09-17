import type { BlogPost, BlogPostSummary } from '../shared/types';

/** 列表索引键（KV 无范围查询，用单个索引数组键承载列表） */
const INDEX_KEY = 'index:posts';

const postKey = (id: string) => `post:${id}`;

export async function getPostIndex(kv: KVNamespace): Promise<BlogPostSummary[]> {
  const raw = await kv.get<BlogPostSummary[]>(INDEX_KEY, 'json');
  return Array.isArray(raw) ? raw : [];
}

export async function getPost(kv: KVNamespace, id: string): Promise<BlogPost | null> {
  return (await kv.get<BlogPost>(postKey(id), 'json')) ?? null;
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
  const post: BlogPost = {
    id: sourceId,
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
  const summary: BlogPostSummary = {
    id: post.id,
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
  await kv.put(
    INDEX_KEY,
    JSON.stringify((await getPostIndex(kv)).filter((s) => s.id !== sourceId)),
  );
  return true;
}
