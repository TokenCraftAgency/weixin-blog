import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../admin';
import { adminLogin, AdminLoginError } from '../api';

/** 管理员登录页（/admin/login）：密码校验 + 锁定倒计时 */
export default function LoginPage() {
  const { isAuthed, logout } = useAdmin();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [lockLeft, setLockLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // 锁定倒计时：本地递减，到 0 自动解除输入限制
  useEffect(() => {
    if (lockUntil === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setLockLeft(left);
      if (left === 0) setLockUntil(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lockUntil]);

  const locked = lockLeft > 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (locked || submitting || !password) return;
    setSubmitting(true);
    setError('');
    setRemaining(null);
    try {
      await adminLogin(password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof AdminLoginError) {
        setError(err.message);
        setRemaining(err.remaining ?? null);
        if (err.code === 'LOCKED') setLockUntil(Date.now() + (err.retryAfter ?? 900) * 1000);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  if (isAuthed) {
    return (
      <div className="login">
        <h1>管理员</h1>
        <p className="login__ok">已登录，文章列表与详情页将显示删除按钮。</p>
        <div className="login__actions">
          <button type="button" className="login__btn" onClick={() => navigate('/')}>
            回到首页
          </button>
          <button
            type="button"
            className="login__btn login__btn--ghost"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <h1>管理员登录</h1>
      <p className="login__hint">登录后即可在管理文章</p>
      <form className="login__form" onSubmit={onSubmit}>
        <input
          type="password"
          placeholder="请输入管理密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={locked}
        />
        <button type="submit" className="login__btn" disabled={locked || submitting || !password}>
          {submitting ? '登录中…' : locked ? `已锁定 ${lockLeft}s` : '登录'}
        </button>
      </form>
      {locked && <div className="login__error">尝试次数过多，请 {lockLeft} 秒后重试</div>}
      {!locked && error && (
        <div className="login__error">
          {error}
          {typeof remaining === 'number' && `，还剩 ${remaining} 次机会`}
        </div>
      )}
    </div>
  );
}
