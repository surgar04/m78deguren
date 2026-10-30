import { execFileSync } from 'node:child_process';

/** 复用 Git 已有登录；只读调用标准凭据助手，不弹登录框、不落盘、不输出凭据。 */
export function readExistingGitHubCredential(): string | undefined {
  try {
    const result = execFileSync(
      'git',
      ['-c', 'credential.interactive=never', 'credential', 'fill'],
      {
        input: 'protocol=https\nhost=github.com\npath=surgar04/m78deguren.git\n\n',
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20000,
        stdio: ['pipe', 'pipe', 'ignore'],
        maxBuffer: 32768,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GCM_GUI_PROMPT: 'false',
        },
      },
    );
    const fields = new Map(
      result.split(/\r?\n/u).flatMap((line) => {
        const separator = line.indexOf('=');
        return separator > 0
          ? [[line.slice(0, separator), line.slice(separator + 1)] as const]
          : [];
      }),
    );
    if (fields.get('host') !== 'github.com' || fields.get('protocol') !== 'https') return undefined;
    const token = fields.get('password');
    return token && token.length <= 4096 && !/\s/u.test(token) ? token : undefined;
  } catch {
    // execFileSync 的错误对象可能带 stdout；绝不将其打印或拼入异常。
    return undefined;
  }
}
