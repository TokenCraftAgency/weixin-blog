import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../admin';
import { deletePost, fetchPost, fetchPostByShortId } from '../api';
import type { BlogPost } from '../../shared/types';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * 复制用：把转存到博客 KV 的图片（src="/img/<hash>.<ext>"）还原为
 * data-src 里保留的公众号 CDN 原链接（微信编辑器只识别 mmbiz 外链）。
 */
function restoreWxLinks(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/\ssrc=["']\/img\//i.test(tag)) return tag;
    const origin = /\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!origin) return tag;
    return tag.replace(/\ssrc=["'][^"']+["']/i, (_m) => ` src="${origin}"`);
  });
}

/** 富文本复制（text/html + text/plain，粘贴到公众号编辑器保留排版）；逐级降级到纯文本 */
async function copyRich(html: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html], { type: 'text/plain' }),
        }),
      ]);
      return;
    }
  } catch {
    /* 降级纯文本 */
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(html);
    return;
  }
  // 最后兜底：隐藏 textarea + execCommand
  const ta = document.createElement('textarea');
  ta.value = html;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

export default function PostPage() {
  // 双入口：/post/:id（列表链路，文章 id）与 /s/:shortId（分享链路，6 位短 ID）
  const { id, shortId } = useParams<{ id?: string; shortId?: string }>();
  const { isAuthed } = useAdmin();
  const navigate = useNavigate();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPost(null);
    setNotFound(false);
    setError('');
    if (!id && !shortId) return;
    const load = shortId ? fetchPostByShortId(shortId) : fetchPost(id!);
    load
      .then((p) => {
        if (cancelled) return;
        if (p === null) setNotFound(true);
        else setPost(p);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id, shortId]);

  const onCopy = async () => {
    if (!post) return;
    try {
      await copyRich(restoreWxLinks(post.contentHtml));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('复制失败，请手动复制');
    }
  };

  // 分享：复制短链接 <站点>/#<短ID>（收不进剪贴板时降级 prompt 手动复制）
  const onShare = async () => {
    if (!post?.shortId) return;
    const url = `${window.location.origin}/#${post.shortId}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard api');
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt('复制分享链接：', url);
    }
  };

  const onDelete = async () => {
    if (!post) return;
    if (!window.confirm(`确认删除《${post.title}》？删除后不可恢复。`)) return;
    setDeleting(true);
    try {
      await deletePost(post.id);
      navigate('/', { replace: true });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  if (notFound) {
    return (
      <div className="state">
        文章不存在，<Link to="/" className="post__back">回到首页</Link>
      </div>
    );
  }
  if (error) return <div className="state state--error">{error}</div>;
  if (!post) return <div className="state">加载中…</div>;

  return (
    <article className="post">
      <header className="post__header">
        <h1 className="post__title">{post.title}</h1>
        <div className="post__meta">
          {post.author && <span>{post.author}</span>}
          <span>{fmtDate(post.createdAt)}</span>
          {post.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
          {post.shortId && (
            <button type="button" className="post__share" onClick={onShare}>
              {shareCopied ? '已复制 ✓' : '分享'}
            </button>
          )}
          <button type="button" className="post__copy" onClick={onCopy}>
            {copied ? '已复制 ✓' : '一键复制'}
          </button>
          {isAuthed && (
            <button
              type="button"
              className="post__delete"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? '删除中…' : '删除文章'}
            </button>
          )}
        </div>
      </header>
      <hr className="post__divider" />
      {post.coverUrl && <img className="post__cover" src={post.coverUrl} alt="" />}
      {/* 内容来自 token 认证的写接口（仅本人可写），原样渲染微信排版 HTML */}
      <div className="post-content" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
      <Link to="/" className="post__back">
        ← 回到首页
      </Link>
    </article>
  );
}
