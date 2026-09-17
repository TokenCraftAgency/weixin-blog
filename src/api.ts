import type { BlogPost, BlogPostSummary } from '../shared/types';

/** 首页文章列表分页页大小 */
export const POSTS_PAGE_SIZE = 10;

/** 首页文章列表（按 offset 分页，滚动加载；q 为标题/id 关键字过滤）；网络/服务错误抛出，由页面展示错误态 */
export async function fetchPosts(
  offset = 0,
  limit = POSTS_PAGE_SIZE,
  q = '',
): Promise<{ posts: BlogPostSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q.trim()) params.set('q', q.trim());
  const res = await fetch(`/api/posts?${params.toString()}`);
  if (!res.ok) throw new Error(`加载文章列表失败（${res.status}）`);
  const data = (await res.json()) as {
    posts: BlogPostSummary[];
    total: number;
    hasMore: boolean;
  };
  return { posts: data.posts, total: data.total, hasMore: data.hasMore === true };
}

/** 文章详情；404 返回 null，其余非 200 抛出 */
export async function fetchPost(id: string): Promise<BlogPost | null> {
  const res = await fetch(`/api/posts/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载文章失败（${res.status}）`);
  const data = (await res.json()) as { post: BlogPost };
  return data.post;
}
