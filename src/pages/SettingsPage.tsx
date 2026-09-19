import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from '../admin';
import { fetchSiteConfig, updateSiteAccess } from '../api';
import type { SiteAccess } from '../../shared/types';

const ACCESS_OPTIONS: { value: SiteAccess; label: string; desc: string }[] = [
  {
    value: 'public',
    label: '公开访问',
    desc: '任何人都能访问首页、文章与关于页。',
  },
  {
    value: 'admin',
    label: '管理员访问',
    desc: '首页仅管理员可见；文章页任何人可通过分享短链接（/#短ID）访问，按文章 id 访问仅限管理员；关于页保持公开。',
  },
];

/** 管理员设置页（/admin/settings）：网站访问权限切换 */
export default function SettingsPage() {
  const { isAuthed } = useAdmin();
  const [saved, setSaved] = useState<SiteAccess | null>(null);
  const [draft, setDraft] = useState<SiteAccess>('public');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSiteConfig()
      .then((cfg) => {
        if (cancelled) return;
        setSaved(cfg.access);
        setDraft(cfg.access);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAuthed) {
    return (
      <div className="state">
        管理员设置需先登录，
        <Link to="/admin/login" className="post__back">
          前往登录
        </Link>
      </div>
    );
  }

  const onSave = async () => {
    if (saving || draft === saved) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await updateSiteAccess(draft);
      setSaved(draft);
      setNotice(draft === 'admin' ? '已保存。首页已对非管理员关闭（注意：自己退出后也需要登录才能看首页）' : '已保存，站点恢复公开访问');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      <h1>管理员设置</h1>
      {saved === null && !error && <div className="state">加载中…</div>}
      {saved !== null && (
        <>
          <fieldset className="settings__group">
            <legend>网站访问权限</legend>
            {ACCESS_OPTIONS.map((opt) => (
              <label key={opt.value} className={`settings__option${draft === opt.value ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="site-access"
                  value={opt.value}
                  checked={draft === opt.value}
                  onChange={() => {
                    setDraft(opt.value);
                    setNotice('');
                  }}
                />
                <div>
                  <span className="settings__option-label">{opt.label}</span>
                  <span className="settings__option-desc">{opt.desc}</span>
                </div>
              </label>
            ))}
          </fieldset>
          <div className="settings__actions">
            <button
              type="button"
              className="login__btn"
              onClick={onSave}
              disabled={saving || draft === saved}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {draft !== saved && <span className="settings__dirty">有未保存的修改</span>}
          </div>
          {notice && <div className="settings__notice">{notice}</div>}
        </>
      )}
      {error && <div className="state state--error">{error}</div>}
    </div>
  );
}
