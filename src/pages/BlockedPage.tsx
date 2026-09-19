// import { Link } from 'react-router-dom';

/**
 * 禁止访问页（403）：管理员访问模式下的拦截落地页。
 * 既作为 /blocked 独立路由，也被首页/详情页受限状态内嵌复用（URL 不变）。
 */
export default function BlockedPage({
  detail = '本站已设为管理员访问，普通访客暂无权限浏览',
}: {
  detail?: string;
}) {
  return (
    <div className="blocked">
      <div className="blocked__icon" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <h1 className="blocked__title">禁止访问</h1>
      <p className="blocked__detail">{detail}</p>
      {/* <div className="blocked__actions">
        <Link to="/admin/login" className="post__delete">
          管理员登录
        </Link>
        <Link to="/" className="post__back">
          返回首页
        </Link>
      </div> */}
    </div>
  );
}
