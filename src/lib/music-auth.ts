/** 授权错误使用固定文案与诊断代码；不把平台响应、账号信息或未知异常直接展示/复制。 */
const failures: Record<string, [string, string]> = {
  'rate-limited': [
    'YouTube Music 暂时限制了请求频率',
    '请等待几分钟再重试，不要连续重复授权；应用不会自动反复请求该账号。',
  ],
  'region-restricted': [
    '该内容在当前地区不可用',
    '请检查账号地区和平台内容可用性；应用不会绕过平台的地区或版权限制。',
  ],
  'not-playable': ['平台未提供可播放音源', '请检查账号权益及歌曲可用性，或尝试其他歌曲。'],
  unsupported: ['平台不支持当前操作或环境', '请检查浏览器和应用版本，复制脱敏诊断后反馈。'],
  'invalid-response': [
    '音乐平台返回了无法识别的结果',
    '请稍后重试；若持续出现，请更新应用或复制脱敏诊断后反馈。',
  ],
  'no-browser': [
    '未找到可用于授权的浏览器',
    '请安装 Chrome、Edge、Chromium 或 Brave 后重试。无需安装 YouTube Music 桌面客户端。',
  ],
  'folder-in-use': [
    '上次授权的专用浏览器仍占用档案',
    '请关闭臻境打开的专用登录窗口后重试，无需关闭日常浏览器或重启电脑。',
  ],
  exited: [
    '专用浏览器提前退出或档案尚未解锁',
    '请重试；若反复出现，请检查浏览器能否正常启动，以及安全软件是否阻止该窗口。',
  ],
  'not-started': [
    '无法启动会话读取浏览器',
    '请检查浏览器安装、应用目录权限及安全软件拦截记录，然后重新授权。',
  ],
  timeout: [
    '读取浏览器登录会话超时',
    '已进行有限重试。请关闭专用窗口后重新授权；若仍失败，请复制脱敏诊断。',
  ],
  protocol: [
    '浏览器返回了无法识别的会话结果',
    '请更新 Chrome 或 Edge 后重试；不会读取日常浏览器的个人资料。',
  ],
  'session-missing': [
    '没有读到有效的 YouTube Music 登录会话',
    '请重新授权，等待 YouTube Music 页面显示你的账号后，再关闭该专用浏览器的所有窗口。只完成 Google 账号输入还不代表音乐会话已就绪。',
  ],
  'session-not-saved': [
    '登录会话无法安全保存',
    '请检查应用数据目录的权限、磁盘空间及 Windows 用户状态；不会以明文保存凭据，请修复后重新授权。',
  ],
  'not-taken': [
    'YouTube Music 没有接受本次登录会话',
    '请确认专用窗口中能打开 YouTube Music 并显示账号，再重新授权。账号验证或地区限制需要在 Google 页面处理。',
  ],
  'no-answer': [
    'YouTube Music 账号验证超时',
    '网页与音乐组件的网络链路不同，请检查 Windows 系统代理或 PAC、DNS 和网络连通性后重试。',
  ],
  'account-missing': [
    '平台响应中没有可用的音乐账号',
    '请在专用窗口内完成 YouTube Music 的账号初始化或账号选择，再重新授权。',
  ],
  dns: [
    '无法解析 YouTube Music 域名',
    '请检查 DNS 或 Windows 系统代理；浏览器扩展代理不会自动供音乐组件使用。',
  ],
  proxy: [
    'Windows 系统代理或 PAC 不可用',
    '请检查系统代理地址、PAC 和代理程序是否正在运行；当前支持 HTTP/HTTPS 系统代理，不会静默改为直连。',
  ],
  tls: [
    '无法建立安全的音乐平台连接',
    '请检查系统时间、网络证书或网络拦截；应用不会关闭 TLS 证书验证。',
  ],
  network: [
    '无法连接 YouTube Music',
    '请检查网络、Windows 系统代理或 PAC；浏览器扩展代理只作用于该浏览器。',
  ],
  'auth-required': [
    'YouTube Music 登录状态已失效',
    '请重新连接账号；平台会员、地区与版权限制保持不变。',
  ],
  'host-timeout': [
    '音乐组件响应超时',
    '服务已重置，可直接重试；若反复出现，请检查网络和组件完整性。无需安装 YouTube Music 桌面客户端。',
  ],
  'host-unavailable': [
    '音乐组件无法启动或已断开',
    '请重试；若持续失败，请使用臻境 MSI 修复安装，并检查安全软件拦截记录。无需安装 YouTube Music 桌面客户端。',
  ],
  'invalid-request': ['音乐授权请求无效', '请关闭连接弹窗后重试；若仍失败，请复制诊断并反馈。'],
  cancelled: ['本次授权已取消', '可以重新打开授权页面开始新的连接。'],
  unavailable: [
    '音乐平台暂时无法完成请求',
    '请稍后重试；若持续失败，请复制脱敏诊断，不要发送 Cookie、密码或令牌。',
  ],
};
export function musicAuthFailure(code: string): { title: string; hint: string } {
  const row = failures[code] ?? failures['unavailable'];
  return { title: row?.[0] ?? '授权未完成', hint: row?.[1] ?? '请重试' };
}
export function musicHostFailure(cause: unknown): string {
  const value = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : '';
  if (/超时|timeout/i.test(value)) return 'host-timeout';
  return 'host-unavailable';
}
/** 仅认可固定代码。未知异常和 cause 的原文不会进入可复制诊断。 */
export function musicAuthCode(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    for (const field of ['cause', 'reason', 'code']) {
      const value: unknown = Reflect.get(cause, field);
      if (typeof value === 'string' && Object.hasOwn(failures, value)) return value;
    }
  }
  return musicHostFailure(cause);
}
