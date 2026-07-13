import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from '../src/shutdown.js';

class SignalTarget extends EventEmitter {
  exitCode: number | undefined;
}

describe('graceful shutdown', () => {
  it('starts one drain when SIGTERM is received', async () => {
    const target = new SignalTarget();
    let finishDrain: (() => void) | undefined;
    const close = vi.fn(() => new Promise<void>((resolve) => {
      finishDrain = resolve;
    }));
    installGracefulShutdown(close, target);

    target.emit('SIGTERM');
    target.emit('SIGINT');

    expect(close).toHaveBeenCalledOnce();
    finishDrain?.();
    await vi.waitFor(() => expect(target.listenerCount('SIGTERM')).toBe(0));
  });

  it('sets a failing exit code when draining rejects', async () => {
    const target = new SignalTarget();
    installGracefulShutdown(() => Promise.reject(new Error('close failed')), target);

    target.emit('SIGTERM');

    await vi.waitFor(() => expect(target.exitCode).toBe(1));
  });
});
