import { convertFileSrc, invoke as rawInvoke, isTauri } from '@tauri-apps/api/core';
import {
  diagnosticRequestSchema,
  type DiagnosticEvent,
  type DiagnosticRequest,
} from './diagnostic-contracts';
import { traceCall } from './diagnostics';
import { z } from 'zod';
import { gameRoomRequestSchema, type GameRoomRequest } from './game-room-contracts';

/** 游戏空间所有调用经过统一诊断与双端校验；远端扫码页面无法获得此能力。 */
export async function executeGameRoom<T>(
  request: GameRoomRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return schema.parse(
    await invoke<unknown>('game_room_execute', { request: gameRoomRequestSchema.parse(request) }),
  );
}
/** 全部业务 IPC 的关联与耗时集中处理，永不记录参数、返回正文或认证票据。 */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const request = z
    .object({ request: z.object({ operation: z.string().max(80) }) })
    .safeParse(args);
  const operation = request.success ? request.data.request.operation : null;
  const trace = traceCall(command, operation);
  try {
    const result = await rawInvoke<T>(command, args);
    const failed = z.object({ ok: z.literal(false) }).safeParse(result).success;
    trace.finish(failed);
    return result;
  } catch (cause) {
    trace.finish(true);
    throw cause;
  }
}
export async function executeDiagnostics<T>(
  request: DiagnosticRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return schema.parse(
    await rawInvoke<unknown>('diagnostics_execute', {
      request: diagnosticRequestSchema.parse(request),
    }),
  );
}
export function reportDiagnostics(entries: DiagnosticEvent[]): Promise<unknown> {
  return executeDiagnostics({ operation: 'ingest', entries }, z.unknown());
}
import {
  workspaceRequestSchema,
  workspaceStatusSchema,
  type WorkspaceRequest,
} from './workspace-contracts';

/** 工作区只传原生目录选择票据，不向原生端传命令、下载地址或仓库分支。 */
export async function executeWorkspace(request: WorkspaceRequest) {
  requireDesktop();
  return workspaceStatusSchema.parse(
    await invoke<unknown>('developer_workspace_execute', {
      request: workspaceRequestSchema.parse(request),
    }),
  );
}
import {
  developerRequestSchema,
  developerStatusSchema,
  type DeveloperRequest,
} from './developer-contracts';

/** stoken 只走认证命令，不放入查询键、错误文本或偏好存储。 */
export async function executeDeveloper(request: DeveloperRequest) {
  requireDesktop();
  return developerStatusSchema.parse(
    await invoke<unknown>('developer_execute', { request: developerRequestSchema.parse(request) }),
  );
}
import { musicRequestSchema, type MusicRequest } from './music-contracts';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toolRequestSchema, type ToolRequest } from './tool-contracts';
import { builtinRequestSchema, type BuiltinRequest } from './builtin-contracts';
import { optimizerRequestSchema, type OptimizerRequest } from './optimization-contracts';
import { settingsRequestSchema, type SettingsRequest } from './settings-contracts';
import { hardwareRequestSchema, type HardwareRequest } from './hardware-contracts';
import { steamRequestSchema, type SteamRequest } from './steam-contracts';
import { homeRequestSchema, type HomeRequest } from './home-contracts';
import { hudRequestSchema, type HudRequest } from './hud-contracts';
import { setupRequestSchema, type SetupRequest } from './onboarding-contracts';
import { accelerationRequestSchema, type AccelerationRequest } from './acceleration-contracts';
import {
  gamesRequestSchema,
  quickRequestSchema,
  type GamesRequest,
  type QuickRequest,
} from './launcher-contracts';

/** 音乐 IPC 与其他领域保持同样的双端校验；路径只通过原生文件选择器登记。 */
export async function executeMusic<T>(request: MusicRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('music_execute', { request: musicRequestSchema.parse(request) }),
  );
}
/** 加速准备仅开放固定官方页面、登记客户端及单次游戏会话。 */
export async function executeAcceleration<T>(
  request: AccelerationRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('acceleration_execute', {
      request: accelerationRequestSchema.parse(request),
    }),
  );
}
export async function executeOtherGames<T>(
  request: GamesRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('other_games_execute', { request: gamesRequestSchema.parse(request) }),
  );
}
export async function executeQuickLaunch<T>(
  request: QuickRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('quick_launch_execute', { request: quickRequestSchema.parse(request) }),
  );
}
export function desktopWindowLabel() {
  return isTauri() ? getCurrentWindow().label : 'browser';
}

/** 首次启动只传受限操作及后端扫描标识，不接受安装命令或任意文件路径。 */
export async function executeSetup<T>(request: SetupRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('onboarding_execute', { request: setupRequestSchema.parse(request) }),
  );
}

/** HUD 的配置、媒体、窗口操作共用严格 IPC 边界，辅助窗口由 Rust 再次限权。 */
export async function executeHud<T>(request: HudRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('hud_execute', { request: hudRequestSchema.parse(request) }),
  );
}

/** 首页程序只接受原生选择票据或登记 UUID，所有输入由 Rust 再次验证。 */
export async function executeHome<T>(request: HomeRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('home_execute', { request: homeRequestSchema.parse(request) }),
  );
}

/** Steam IPC 只接受后端扫描产生的应用/账号 ID，不能从视图传入路径、URI 或命令行。 */
export async function executeSteam<T>(request: SteamRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('steam_execute', { request: steamRequestSchema.parse(request) }),
  );
}

/** 硬件命令统一验证请求和响应；前端不能指定助手、导出目录或 ETW 会话名称。 */
export async function executeHardware<T>(
  request: HardwareRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('hardware_execute', { request: hardwareRequestSchema.parse(request) }),
  );
}

/** 设置网关同样只接受有限动作；导入通过原生文件选择器，前端不能指定写入目标。 */
export async function executeSettings<T>(
  request: SettingsRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('settings_execute', { request: settingsRequestSchema.parse(request) }),
  );
}
export function settingsAssetUrl(id: string) {
  requireDesktop();
  return convertFileSrc(
    z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(id),
    'zhenjing-asset',
  );
}

/** 优化页同样使用唯一原生入口，视图不能指定任意命令或注册表写入路径。 */
export async function executeOptimizer<T>(
  request: OptimizerRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  return response.parse(
    await invoke<unknown>('optimizer_execute', { request: optimizerRequestSchema.parse(request) }),
  );
}

/** 所有工具原生调用只经过本入口；不向页面暴露任意invoke字符串。 */
export async function executeTool<T>(request: ToolRequest, response: z.ZodType<T>): Promise<T> {
  requireDesktop();
  const validated = toolRequestSchema.parse(request);
  return response.parse(await invoke<unknown>('tools_execute', { request: validated }));
}

/** 扩展系统工具沿用唯一 IPC 网关；页面不能直接指定原生命令名。 */
export async function executeBuiltin<T>(
  request: BuiltinRequest,
  response: z.ZodType<T>,
): Promise<T> {
  requireDesktop();
  const validated = builtinRequestSchema.parse(request);
  return response.parse(await invoke<unknown>('builtin_execute', { request: validated }));
}

/** 媒体协议只接受Rust扫描产生的摘要ID，不能传本地路径。 */
export function recordingMediaUrl(id: string) {
  requireDesktop();
  return convertFileSrc(
    z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(id),
    'zhenjing-media',
  );
}

// IPC 数据在边界处做运行时校验，Rust 返回结构发生变化时显式报错。
export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  architecture: z.string(),
});
export const greetingFormSchema = z.object({
  name: z
    .string()
    .trim()
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= 1 && length <= 40 && !/\p{Cc}/u.test(value);
    }, '请输入 1 至 40 个字符的名字，且不含控制字符'),
});
export type GreetingForm = z.infer<typeof greetingFormSchema>;

function requireDesktop() {
  if (!isTauri()) throw new Error('请在桌面应用中连接 Rust 后端');
}

export function isDesktop() {
  return isTauri();
}

export async function getAppInfo() {
  requireDesktop();
  return appInfoSchema.parse(await invoke<unknown>('app_info'));
}

export async function greet(input: GreetingForm) {
  requireDesktop();
  const args = greetingFormSchema.parse(input);
  return z.object({ message: z.string() }).parse(await invoke<unknown>('greet', args));
}

/** 只暴露白名单窗口动作；网页预览不能伪装成已经执行原生操作。 */
export async function controlWindow(action: 'minimize' | 'maximize' | 'close') {
  requireDesktop();
  const window = getCurrentWindow();
  if (action === 'minimize') await window.minimize();
  else if (action === 'maximize') await window.toggleMaximize();
  else await window.close();
}

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return '返回的数据格式不符合约定';
  if (error instanceof Error) return error.message;
  const structured = z
    .object({ code: z.string(), message: z.string().optional() })
    .safeParse(error);
  if (structured.success) {
    if (structured.data.code === 'INVALID_NAME') return '请输入 1 至 40 个字符的名字';
    if (structured.data.code === 'INVALID_REPORT') return '报告格式不正确或内容过大';
    if (structured.data.code === 'REPORT_STORAGE') return '报告只能保存到应用数据目录';
    if (structured.data.code === 'REPORT_WRITE')
      return '报告保存失败，请检查目标磁盘空间和目录权限';
    if (structured.data.code === 'REPORT_TASK') return '报告保存任务未能完成，请重试';
    return structured.data.message ?? '操作失败，请重试';
  }
  return '操作失败，请重试';
}
