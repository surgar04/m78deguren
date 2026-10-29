import { useEffect, useId, useRef, type ReactNode } from 'react';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';

/** 原生 dialog 提供焦点约束、Escape 关闭及背景惰性，不手写易错的焦点陷阱。 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // React 会在 effect 清理前移除节点；显式恢复仍在文档中的触发器，避免焦点落回 body。
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`home-modal ${wide ? 'modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // 关闭由 React 状态统一驱动，避免原生默认关闭与卸载/下一个弹窗发生竞争。
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <Icon icon={faXmark} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
