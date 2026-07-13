type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export type ShutdownSignalTarget = {
  exitCode?: string | number | null | undefined;
  once(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener(signal: ShutdownSignal, listener: () => void): unknown;
};

export function installGracefulShutdown(
  close: () => Promise<void>,
  target: ShutdownSignalTarget = process,
): () => void {
  let draining = false;

  const dispose = (): void => {
    target.removeListener('SIGINT', handleSignal);
    target.removeListener('SIGTERM', handleSignal);
  };
  const handleSignal = (): void => {
    if (draining) return;
    draining = true;
    dispose();
    void close().catch(() => {
      target.exitCode = 1;
    });
  };

  target.once('SIGINT', handleSignal);
  target.once('SIGTERM', handleSignal);
  return dispose;
}
