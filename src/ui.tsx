import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * 自定义系统弹窗（替代 alert/confirm/prompt）：
 * 模块级状态 + 订阅，任意处调用 alertDlg/confirmDlg/copyDlg，
 * <UIDialogs /> 挂在 App 顶层统一渲染。
 */
type Dialog =
  | { kind: 'alert'; title: string; message: string }
  | { kind: 'confirm'; title: string; message: string; danger?: boolean }
  | { kind: 'copy'; title: string; value: string }
  | null;

let current: Dialog = null;
let resolveConfirm: ((v: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function close(): void {
  resolveConfirm?.(false);
  resolveConfirm = null;
  current = null;
  emit();
}

function accept(): void {
  resolveConfirm?.(true);
  resolveConfirm = null;
  current = null;
  emit();
}

/** 提示弹窗（替代 alert） */
export function alertDlg(message: string, title = '提示'): void {
  current = { kind: 'alert', title, message };
  emit();
}

/** 确认弹窗（替代 confirm），resolve true/false */
export function confirmDlg(
  message: string,
  opts?: { title?: string; danger?: boolean; okText?: string },
): Promise<boolean> {
  current = { kind: 'confirm', title: opts?.title ?? '确认操作', message, danger: opts?.danger };
  emit();
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

/** 复制兜底弹窗（替代 prompt）：展示只读文本并预选，供手动复制 */
export function copyDlg(value: string, title = '复制链接'): void {
  current = { kind: 'copy', title, value };
  emit();
}

export function UIDialogs() {
  const dlg = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  }, []);
  useEffect(() => {
    if (!dlg) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dlg, onKeyDown]);

  if (!dlg) return null;

  return (
    <div
      className="dialog__mask"
      role="dialog"
      aria-modal="true"
      aria-label={dlg.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={`dialog${dlg.kind === 'confirm' && dlg.danger ? ' dialog--danger' : ''}`}>
        <h3 className="dialog__title">{dlg.title}</h3>
        {dlg.kind === 'copy' ? (
          <>
            <p className="dialog__message">链接已选中，按 Ctrl+C 复制：</p>
            <input
              className="dialog__input"
              readOnly
              value={dlg.value}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </>
        ) : (
          <p className="dialog__message">{dlg.message}</p>
        )}
        <div className="dialog__actions">
          {dlg.kind === 'confirm' && (
            <button type="button" className="dialog__btn dialog__btn--ghost" onClick={close}>
              取消
            </button>
          )}
          {dlg.kind === 'copy' ? (
            <button type="button" className="dialog__btn" onClick={close}>
              知道了
            </button>
          ) : (
            <button
              type="button"
              className={`dialog__btn${dlg.kind === 'confirm' && dlg.danger ? ' dialog__btn--danger' : ''}`}
              onClick={accept}
            >
              {dlg.kind === 'confirm' ? '确认' : '好的'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
