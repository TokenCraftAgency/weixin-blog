import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from '../admin';
import { fetchAdminConfig, fetchLoginLogs, updateSiteConfig, type AdminSiteConfig } from '../api';
import type { LoginLogEntry, SiteAccess } from '../../shared/types';

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

type Tab = 'access' | 'gate' | 'logs';

/** 登录日志分页页大小 */
const LOGS_PAGE_SIZE = 10;

const TABS: { value: Tab; label: string }[] = [
  { value: 'access', label: '访问权限' },
  { value: 'gate', label: '门禁设置' },
  { value: 'logs', label: '登录日志' },
];

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const RESULT_LABEL: Record<LoginLogEntry['r'], { text: string; cls: string }> = {
  ok: { text: '成功', cls: 'is-ok' },
  fail: { text: '密码错误', cls: 'is-fail' },
  locked: { text: '锁定拒绝', cls: 'is-locked' },
};

/** 管理员设置页（/admin/settings）：访问权限 / 门禁参数 / 登录日志 */
export default function SettingsPage() {
  const { isAuthed, logout } = useAdmin();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('access');
  const [config, setConfig] = useState<AdminSiteConfig | null>(null);
  const [accessDraft, setAccessDraft] = useState<SiteAccess>('public');
  const [failLimit, setFailLimit] = useState('5');
  const [lockMinutes, setLockMinutes] = useState('15');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<LoginLogEntry[] | null>(null);
  const [logsError, setLogsError] = useState('');
  const [logsPage, setLogsPage] = useState(1);

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    fetchAdminConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setAccessDraft(cfg.access);
        setFailLimit(String(cfg.failLimit));
        setLockMinutes(String(cfg.lockMinutes));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  // 日志切到该 tab 时加载（重复进入刷新，回到第一页）
  useEffect(() => {
    if (tab !== 'logs' || !isAuthed) return;
    let cancelled = false;
    setLogs(null);
    setLogsError('');
    setLogsPage(1);
    fetchLoginLogs()
      .then((l) => !cancelled && setLogs(l))
      .catch((err) => !cancelled && setLogsError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [tab, isAuthed]);

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

  const save = async (patch: Partial<AdminSiteConfig>, successNotice: string) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const cfg = await updateSiteConfig(patch);
      setConfig(cfg);
      setNotice(successNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const gateDirty =
    config !== null && (Number(failLimit) !== config.failLimit || Number(lockMinutes) !== config.lockMinutes);
  const gateValid =
    Number.isInteger(Number(failLimit)) && Number(failLimit) >= 1 && Number(failLimit) <= 20 &&
    Number.isInteger(Number(lockMinutes)) && Number(lockMinutes) >= 1 && Number(lockMinutes) <= 1440;

  return (
    <div className="settings">
      <h1>管理员设置</h1>
      <p className="settings__sub">管理站点访问权限、登录门禁策略与安全审计日志</p>
      <div className="settings__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={`settings__tab${tab === t.value ? ' is-active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {config === null && !error && <div className="state">加载中…</div>}

      {config !== null && tab === 'access' && (
        <>
          <fieldset className="settings__group">
            <legend>网站访问权限</legend>
            {ACCESS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`settings__option${accessDraft === opt.value ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="site-access"
                  value={opt.value}
                  checked={accessDraft === opt.value}
                  onChange={() => {
                    setAccessDraft(opt.value);
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
              onClick={() =>
                save(
                  { access: accessDraft },
                  accessDraft === 'admin'
                    ? '已保存。首页已对非管理员关闭（注意：自己退出后也需要登录才能看首页）'
                    : '已保存，站点恢复公开访问',
                )
              }
              disabled={saving || accessDraft === config.access}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {accessDraft !== config.access && <span className="settings__dirty">有未保存的修改</span>}
          </div>
        </>
      )}

      {config !== null && tab === 'gate' && (
        <>
          <fieldset className="settings__group">
            <legend>登录失败锁定（保存后立即生效）</legend>
            <div className="settings__gate">
              <span>连续失败</span>
              <input
                type="number"
                min={1}
                max={20}
                value={failLimit}
                onChange={(e) => setFailLimit(e.target.value)}
              />
              <span>次，锁定</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={lockMinutes}
                onChange={(e) => setLockMinutes(e.target.value)}
              />
              <span>分钟</span>
            </div>
            <p className="settings__hint">
              失败同时计入「客户端 IP」与「浏览器指纹」两个独立维度，任一维度达到上限即两个维度同时锁定；换浏览器或换 IP 都无法绕过。
            </p>
          </fieldset>
          <div className="settings__actions">
            <button
              type="button"
              className="login__btn"
              onClick={() => save({ failLimit: Number(failLimit), lockMinutes: Number(lockMinutes) }, '门禁参数已保存')}
              disabled={saving || !gateDirty || !gateValid}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            {!gateValid && <span className="settings__dirty">取值需为整数：失败次数 1-20、锁定分钟 1-1440</span>}
            {gateValid && gateDirty && <span className="settings__dirty">有未保存的修改</span>}
          </div>
        </>
      )}

      {config !== null && tab === 'logs' && (
        <div className="logs">
          {logsError && <div className="state state--error">{logsError}</div>}
          {!logsError && logs === null && <div className="state">加载中…</div>}
          {!logsError && logs !== null && logs.length === 0 && <div className="state">暂无登录记录</div>}
          {!logsError && logs !== null && logs.length > 0 && (
            <>
              <table className="logs__table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>结果</th>
                    <th>IP</th>
                    <th>指纹</th>
                    <th>UA</th>
                  </tr>
                </thead>
                <tbody>
                  {logs
                    .slice((logsPage - 1) * LOGS_PAGE_SIZE, logsPage * LOGS_PAGE_SIZE)
                    .map((l, i) => (
                      <tr key={`${l.t}-${i}`}>
                        <td>{fmtTime(l.t)}</td>
                        <td>
                          <span className={`logs__badge ${RESULT_LABEL[l.r].cls}`}>{RESULT_LABEL[l.r].text}</span>
                        </td>
                        <td>{l.ip}</td>
                        <td className="logs__mono">{l.fp || '—'}</td>
                        <td className="logs__ua" title={l.ua}>
                          {l.ua || '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {logs.length > LOGS_PAGE_SIZE && (
                <div className="logs__pager">
                  <button
                    type="button"
                    className="logs__pager-btn"
                    disabled={logsPage <= 1}
                    onClick={() => setLogsPage((p) => p - 1)}
                  >
                    上一页
                  </button>
                  <span className="logs__pager-info">
                    第 {logsPage} / {Math.ceil(logs.length / LOGS_PAGE_SIZE)} 页 · 共 {logs.length} 条
                  </span>
                  <button
                    type="button"
                    className="logs__pager-btn"
                    disabled={logsPage >= Math.ceil(logs.length / LOGS_PAGE_SIZE)}
                    onClick={() => setLogsPage((p) => p + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {notice && <div className="settings__notice">{notice}</div>}
      {error && <div className="state state--error">{error}</div>}

      {/* 退出入口（原在导航栏） */}
      <div className="settings__account">
        <button
          type="button"
          className="settings__logout"
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
