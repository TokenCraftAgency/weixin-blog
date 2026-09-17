import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/** 吸顶导航 + 内容区 + 页脚（配色与公众号搭子官网一致） */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <header className="nav">
        <div className="nav__inner">
          <NavLink to="/" className="nav__brand">
            <span className="nav__logo" aria-hidden="true" />
            博客
          </NavLink>
          <nav className="nav__links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
              首页
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              关于
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="main">{children}</main>
      <footer className="footer">
        <p>由 公众号搭子 自动同步更新</p>
      </footer>
    </div>
  );
}
