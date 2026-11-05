import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PluginReview } from './PluginsPage';
import { pluginRecordSchema } from '@/lib/plugin-contracts';
import manifest from '../../../plugins/examples/rust/manifest.json';

const action = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null }));
vi.mock('./repository', () => ({
  usePluginAction: () => action,
  usePlugins: () => ({ data: undefined }),
}));
// JSDOM 未实现原生 dialog；只补浏览器开关行为，授权、校验与提交均使用实际组件。
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('插件授权复核', () => {
  it('撤权/回退后仍可重新选择必需权限并确认启用', () => {
    const plugin = pluginRecordSchema.parse({
      manifest,
      digest: 'a'.repeat(64),
      publisherKey: 'b'.repeat(64),
      grants: [],
      enabled: false,
      quarantined: false,
      failures: 0,
      previous: null,
      running: false,
    });
    render(
      <PluginReview
        review={{ kind: 'permissions', plugin }}
        revision={7}
        onClose={() => undefined}
        onDone={() => undefined}
      />,
    );
    const permission = screen.getByRole('checkbox', { name: /插件私有存储/ });
    expect(permission).toBeChecked();
    expect(permission).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已核对来源/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(action.mutate).toHaveBeenCalledWith(
      {
        operation: 'configure',
        id: manifest.id,
        digest: plugin.digest,
        enabled: true,
        grants: ['storage'],
        revision: 7,
        consent: true,
      },
      expect.any(Object),
    );
  });
});
