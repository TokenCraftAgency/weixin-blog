import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdmin } from '../admin';

/** 吸顶导航 + 内容区 + 页脚（配色与公众号搭子官网一致）；管理员入口在页脚，退出在设置页 */
export default function Layout({ children }: { children: ReactNode }) {
  const { isAuthed } = useAdmin();
  return (
    <div className="site">
      <header className="nav">
        <div className="nav__inner">
          <NavLink to="/" className="nav__brand">
            <span className="nav__logo" aria-hidden="true" />
            <span className="nav__brand-text">公众号搭子</span>
          </NavLink>
          <nav className="nav__links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
              首页
            </NavLink>
            {/* 登录成功后隐藏关于页入口 */}
            {!isAuthed && (
              <NavLink to="/about" className={({ isActive }) => (isActive ? 'is-active' : '')}>
                关于
              </NavLink>
            )}
            {isAuthed && (
              <NavLink
                to="/admin/settings"
                className={({ isActive }) => (isActive ? 'nav__admin is-active' : 'nav__admin')}
              >
                设置
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <p>
          由 公众号搭子 自动同步更新
          {!isAuthed && (
            <>
              {' · '}
              <Link to="/admin/login" className="footer__admin">
                管理员
              </Link>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
