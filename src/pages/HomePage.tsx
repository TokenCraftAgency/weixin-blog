import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPosts } from '../api';
import type { BlogPostSummary } from '../../shared/types';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export default function HomePage() {
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);

  // 首屏 / 关键字变化：回到第 1 页重新拉取
  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    setError('');
    fetchPosts(0, 10, keyword)
      .then((r) => {
        if (cancelled) return;
        setPosts(r.posts);
        setHasMore(r.hasMore);
        setTotal(r.total);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  // 滚动分页：哨兵元素进入视口即加载下一页（busyRef 防并发重复加载）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || !posts) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || busyRef.current) return;
        busyRef.current = true;
        setLoadingMore(true);
        fetchPosts(posts.length, 10, keyword)
          .then((r) => {
            setPosts((prev) => [...(prev ?? []), ...r.posts]);
            setHasMore(r.hasMore);
            setTotal(r.total);
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => {
            busyRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, posts, keyword]);

  return (
    <>
      <div className="home-hero">
        <h1>文章</h1>
        <p>写作、洗稿任务完成后自动同步至此{total > 0 ? ` · ${keyword ? `匹配 ${total} 篇` : `共 ${total} 篇`}` : ''}</p>
      </div>
      <form
        className="home-search"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(input.trim());
        }}
      >
        <input
          type="search"
          placeholder="搜索文章标题或 ID"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">搜索</button>
      </form>
      {error && <div className="state state--error">{error}</div>}
      {!error && posts === null && <div className="state">加载中…</div>}
      {posts && (
        <>
          {posts.length === 0 && (
            <div className="state">{keyword ? '没有匹配的文章' : '还没有文章，去公众号搭子里写一篇吧'}</div>
          )}
          <div className="post-list">
            {posts.map((p) => (
              <Link key={p.id} to={`/post/${p.id}`} className="post-card">
                {p.coverUrl && <img className="post-card__cover" src={p.coverUrl} alt="" loading="lazy" />}
                <div className="post-card__body">
                  <h2 className="post-card__title">{p.title}</h2>
                  {p.digest && <p className="post-card__digest">{p.digest}</p>}
                  <div className="post-card__meta">
                    <span>{fmtDate(p.createdAt)}</span>
                    {p.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="state">{loadingMore ? '加载中…' : ''}</div>}
        </>
      )}
    </>
  );
}
