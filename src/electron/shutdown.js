"use strict";

export function waitForShutdown(shutdown, options = {}) {
  if (typeof shutdown !== "function") throw new TypeError("shutdown must be a function");
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(60_000, Number(options.timeoutMs)))
    : 5_000;
  const rejectOnTimeout = options.rejectOnTimeout === true;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      const error = new Error(`The local service did not stop within ${timeoutMs}ms.`);
      error.code = "SERVER_STOP_TIMEOUT";
      if (rejectOnTimeout) finish(reject, error);
      else finish(resolve, { timedOut: true });
    }, timeoutMs);
    timer.unref?.();

    Promise.resolve()
      .then(shutdown)
      .then(
        () => finish(resolve, { timedOut: false }),
        (error) => finish(reject, error),
      );
  });
}
