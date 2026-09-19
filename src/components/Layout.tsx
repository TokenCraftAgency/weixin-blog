import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdmin } from '../admin';

/** 吸顶导航 + 内容区 + 页脚（配色与公众号搭子官网一致） */
export default function Layout({ children }: { children: ReactNode }) {
  const { isAuthed, logout } = useAdmin();
  const navigate = useNavigate();
  return (
    <div className="site">
      <header className="nav">
        <div className="nav__inner">
          <NavLink to="/" className="nav__brand">
            <span className="nav__logo" aria-hidden="true" />
            公众号搭子
          </NavLink>
          <nav className="nav__links">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
              首页
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? 'is-active' : '')}>
              关于
            </NavLink>
            {isAuthed ? (
              <>
                <NavLink to="/admin/settings" className={({ isActive }) => (isActive ? 'nav__admin is-active' : 'nav__admin')}>
                  设置
                </NavLink>
                <button
                  type="button"
                  className="nav__admin"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  退出
                </button>
              </>
            ) : (
              <NavLink to="/admin/login" className="nav__admin">
                管理员
              </NavLink>
            )}
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
