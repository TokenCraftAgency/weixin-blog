import { useCallback, useSyncExternalStore } from 'react';
import { clearToken, loadToken } from './api';

/**
 * 轻量登录态：localStorage 存无状态令牌，变化经 'blog-admin-change' /
 * 'storage'（跨标签页）事件广播，各组件通过 useAdmin 订阅。
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('blog-admin-change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('blog-admin-change', onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useAdmin(): { isAuthed: boolean; logout: () => void } {
  // snapshot 用登录态布尔值本身，避免令牌字符串变化引起多余渲染
  const isAuthed = useSyncExternalStore(subscribe, () => loadToken() !== null);
  const logout = useCallback(() => clearToken(), []);
  return { isAuthed, logout };
}
