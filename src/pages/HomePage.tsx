import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from '../admin';
import { deletePost, fetchPosts, SiteLockedError } from '../api';
import { alertDlg, confirmDlg } from '../ui';
import BlockedPage from './BlockedPage';
import type { BlogPostSummary } from '../../shared/types';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

/** 长按判定时长（ms）与移动容差（px），触屏通用手感区间 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

export default function HomePage() {
  const { isAuthed } = useAdmin();
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  // 长按唤起的删除按钮：同时仅一张卡片激活
  const [deleteVisibleId, setDeleteVisibleId] = useState<string | null>(null);
  const pressTimerRef = useRef<number | undefined>(undefined);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);
  // 长按后松手会补发 click（会误跳详情），置标后由 onClickCapture 吞掉一次
  const swallowClickRef = useRef(false);

  const cancelLongPress = () => {
    window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = undefined;
  };

  // 仅管理员绑定：touchstart 起计时，移动超阈/取消即中止，到时显现删除按钮
  const longPressProps = (id: string) => ({
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      swallowClickRef.current = false;
      pressOriginRef.current = { x: t.clientX, y: t.clientY };
      cancelLongPress();
      pressTimerRef.current = window.setTimeout(() => {
        setDeleteVisibleId(id);
        swallowClickRef.current = true;
        navigator.vibrate?.(10); // 轻震反馈（不支持则静默）
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const o = pressOriginRef.current;
      const t = e.touches[0];
      if (o && (Math.abs(t.clientX - o.x) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(t.clientY - o.y) > LONG_PRESS_MOVE_TOLERANCE)) {
        cancelLongPress(); // 视为滚动意图
      }
    },
    onTouchEnd: cancelLongPress,
    onTouchCancel: cancelLongPress,
    onClickCapture: (e: React.MouseEvent) => {
      if (swallowClickRef.current) {
        e.preventDefault();
        e.stopPropagation();
        swallowClickRef.current = false;
      }
    },
  });

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
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SiteLockedError) {
          setLocked(true);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
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

  // 管理员删除：自定义确认弹窗后调接口，成功则本地移除该条（失败弹窗提示，不整页刷新）
  const onDelete = async (p: BlogPostSummary) => {
    const ok = await confirmDlg(`确认删除《${p.title}》？删除后不可恢复。`, {
      title: '删除文章',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePost(p.id);
      setPosts((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alertDlg(err instanceof Error ? err.message : String(err), '删除失败');
    }
  };

  // 管理员访问模式（未登录）：呈现禁止访问页
  if (locked) {
    return <BlockedPage detail="本站已设为管理员访问，登录后即可查看文章" />;
  }

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
              <div
                key={p.id}
                className={`post-card-slot${deleteVisibleId === p.id ? ' is-active' : ''}`}
                {...(isAuthed ? longPressProps(p.id) : {})}
              >
                <Link to={`/post/${p.id}`} className="post-card">
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
                {isAuthed && (
                  <button
                    type="button"
                    className="post-card__delete"
                    title="删除这篇文章"
                    aria-label="删除这篇文章"
                    onClick={() => {
                      setDeleteVisibleId(null);
                      onDelete(p);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          {hasMore && <div ref={sentinelRef} className="state">{loadingMore ? '加载中…' : ''}</div>}
        </>
      )}
    </>
  );
}
