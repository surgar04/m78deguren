/** 原始快照完整保留用于溯源，生产目录只部署仍受支持链路的本地依赖闭包。 */
export function musicVendorFileAllowed(relative: string): boolean {
  const name = relative.replaceAll('\\', '/');
  if (name.startsWith('/') || name.split('/').some((part) => part === '..')) return false;
  return (
    [
      '',
      'LICENSE',
      'electron',
      'shared',
      'electron/netease',
      'electron/ytm',
      'electron/transcode',
      'electron/transcode/protocol.cjs',
      'electron/backendLifecycle.cjs',
      'electron/networkRecorder.cjs',
    ].includes(name) ||
    ['electron/netease/', 'electron/ytm/', 'shared/'].some((prefix) => name.startsWith(prefix))
  );
}
