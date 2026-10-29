import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadLocalHomeData } from './data/repository';
import type { DialogState } from './types';
/** 所有页面共用快捷搜索与弹窗；此处只管理公共界面，业务状态统一由原生服务查询。 */
export function useGameWorkspace() {
  const query = useQuery({
    queryKey: ['workspace'],
    queryFn: loadLocalHomeData,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const [dialog, setDialog] = useState<DialogState>(null),
    [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(message);
    timer.current = setTimeout(() => setToast(''), 4600);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog((current) => (current?.kind === 'search' ? null : { kind: 'search' }));
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('keydown', shortcut);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return { query, dialog, setDialog, toast, notify };
}
export type GameWorkspaceController = ReturnType<typeof useGameWorkspace>;
