import { describe, expect, it } from 'vitest';
import { workspaceRequestSchema, workspaceStatusSchema } from './workspace-contracts';
import { settingsRequestSchema } from './settings-contracts';
describe('开发工作区和发行切换 IPC', () => {
  it('不允许界面传入路径、命令、仓库或任意分支', () => {
    expect(
      workspaceRequestSchema.safeParse({ operation: 'select', directory: 'D:/user-data' }).success,
    ).toBe(false);
    expect(
      workspaceRequestSchema.safeParse({
        operation: 'prepare',
        ticket: 'not-a-ticket',
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      workspaceRequestSchema.safeParse({
        operation: 'prepare',
        ticket: '01508c18-5b0b-443e-a381-dc4cb91610fe',
        consent: true,
        command: 'run',
        branch: 'main',
      }).success,
    ).toBe(false);
    expect(settingsRequestSchema.safeParse({ operation: 'update-developer' }).success).toBe(false);
    expect(
      settingsRequestSchema.safeParse({ operation: 'update-developer', consent: true }).success,
    ).toBe(true);
    expect(
      workspaceStatusSchema.safeParse({
        phase: 'ready',
        message: '',
        root: null,
        branch: 'main',
        commit: null,
        promptRequired: false,
        ticket: null,
      }).success,
    ).toBe(false);
  });
});
