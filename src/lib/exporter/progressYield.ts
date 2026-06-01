interface ProgressYieldSchedulerOptions {
  intervalMs?: number;
  now?: () => number;
  yieldToEventLoop?: () => Promise<void>;
}

const DEFAULT_PROGRESS_PAINT_INTERVAL_MS = 100;

export function createProgressYieldScheduler({
  intervalMs = DEFAULT_PROGRESS_PAINT_INTERVAL_MS,
  now = () => performance.now(),
  yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
}: ProgressYieldSchedulerOptions = {}) {
  let lastYieldAt: number | null = null;

  return {
    async maybeYield(): Promise<void> {
      const currentTime = now();
      if (lastYieldAt !== null && currentTime - lastYieldAt < intervalMs) {
        return;
      }

      lastYieldAt = currentTime;
      await yieldToEventLoop();
    },
  };
}
