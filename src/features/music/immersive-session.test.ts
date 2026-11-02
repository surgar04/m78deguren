import { expect, it, vi } from 'vitest';
import { createImmersiveSession } from './immersive-session';

it('桌面歌词可以订阅沉浸会话，进入时停表，最后一个所有者退出后恢复', async () => {
  const controller = createImmersiveSession(() => Promise.resolve()),
    changed = vi.fn();
  const stop = controller.subscribe(changed);
  expect(controller.snapshot()).toBe(false);
  const first = controller.acquire(),
    second = controller.acquire();
  await first.release();
  expect(controller.snapshot()).toBe(true);
  await second.release();
  expect(controller.snapshot()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(3);
  stop();
  const final = controller.acquire();
  await final.release();
  expect(changed).toHaveBeenCalledTimes(3);
});

it('双挂载或快速重新进入时，旧会话不得关闭新会话', async () => {
  let resume: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const apply = vi
    .fn<(enabled: boolean) => Promise<void>>()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue(undefined);
  const controller = createImmersiveSession(apply);
  const first = controller.acquire();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(true));
  const cleanup = first.release();
  const second = controller.acquire();
  resume?.();
  await Promise.all([first.ready, cleanup, second.ready]);
  expect(apply.mock.calls).toEqual([[true]]);
  await second.release();
  expect(apply.mock.calls).toEqual([[true], [false]]);
});

it('进入尚未执行就退出时，不应先闪现全屏', async () => {
  const apply = vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined);
  const lease = createImmersiveSession(apply).acquire();
  await lease.release();
  await lease.ready;
  expect(apply.mock.calls).toEqual([[false]]);
});
