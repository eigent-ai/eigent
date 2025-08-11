// src/utils/promises.tsx
import { KnownError } from "..";
import { StackAssertionError, captureError, concatStacktraces } from "./errors";
import { DependenciesMap } from "./maps";
import { Result } from "./results";
import { generateUuid } from "./uuids";
function createPromise(callback) {
  let status = "pending";
  let valueOrReason = void 0;
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = (value) => {
      if (status !== "pending") return;
      status = "fulfilled";
      valueOrReason = value;
      res(value);
    };
    reject = (reason) => {
      if (status !== "pending") return;
      status = "rejected";
      valueOrReason = reason;
      rej(reason);
    };
  });
  callback(resolve, reject);
  return Object.assign(promise, {
    status,
    ...status === "fulfilled" ? { value: valueOrReason } : {},
    ...status === "rejected" ? { reason: valueOrReason } : {}
  });
}
var resolvedCache = null;
function resolved(value) {
  resolvedCache ??= new DependenciesMap();
  if (resolvedCache.has([value])) {
    return resolvedCache.get([value]);
  }
  const res = Object.assign(Promise.resolve(value), {
    status: "fulfilled",
    value
  });
  resolvedCache.set([value], res);
  return res;
}
var rejectedCache = null;
function rejected(reason) {
  rejectedCache ??= new DependenciesMap();
  if (rejectedCache.has([reason])) {
    return rejectedCache.get([reason]);
  }
  const promise = Promise.reject(reason);
  ignoreUnhandledRejection(promise);
  const res = Object.assign(promise, {
    status: "rejected",
    reason
  });
  rejectedCache.set([reason], res);
  return res;
}
var neverResolvePromise = pending(new Promise(() => {
}));
function neverResolve() {
  return neverResolvePromise;
}
function pending(promise, options = {}) {
  const res = promise.then(
    (value) => {
      res.status = "fulfilled";
      res.value = value;
      return value;
    },
    (actualReason) => {
      res.status = "rejected";
      res.reason = actualReason;
      throw actualReason;
    }
  );
  res.status = "pending";
  return res;
}
function ignoreUnhandledRejection(promise) {
  promise.catch(() => {
  });
}
async function wait(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new StackAssertionError(`wait() requires a non-negative integer number of milliseconds to wait. (found: ${ms}ms)`);
  }
  if (ms >= 2 ** 31) {
    throw new StackAssertionError("The maximum timeout for wait() is 2147483647ms (2**31 - 1). (found: ${ms}ms)");
  }
  return await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitUntil(date) {
  return await wait(date.getTime() - Date.now());
}
function runAsynchronouslyWithAlert(...args) {
  return runAsynchronously(
    args[0],
    {
      ...args[1],
      onError: (error) => {
        if (KnownError.isKnownError(error) && typeof process !== "undefined" && process.env.NODE_ENV?.includes("production")) {
          alert(error.message);
        } else {
          alert(`An unhandled error occurred. Please ${process.env.NODE_ENV === "development" ? `check the browser console for the full error.` : "report this to the developer."}

${error}`);
        }
        args[1]?.onError?.(error);
      }
    },
    ...args.slice(2)
  );
}
function runAsynchronously(promiseOrFunc, options = {}) {
  if (typeof promiseOrFunc === "function") {
    promiseOrFunc = promiseOrFunc();
  }
  const duringError = new Error();
  promiseOrFunc?.catch((error) => {
    options.onError?.(error);
    const newError = new StackAssertionError(
      "Uncaught error in asynchronous function: " + error.toString(),
      { cause: error }
    );
    concatStacktraces(newError, duringError);
    if (!options.noErrorLogging) {
      captureError("runAsynchronously", newError);
    }
  });
}
var TimeoutError = class extends Error {
  constructor(ms) {
    super(`Timeout after ${ms}ms`);
    this.ms = ms;
    this.name = "TimeoutError";
  }
};
async function timeout(promise, ms) {
  return await Promise.race([
    promise.then((value) => Result.ok(value)),
    wait(ms).then(() => Result.error(new TimeoutError(ms)))
  ]);
}
async function timeoutThrow(promise, ms) {
  return Result.orThrow(await timeout(promise, ms));
}
function rateLimited(func, options) {
  let waitUntil2 = performance.now();
  let queue = [];
  let addedToQueueCallbacks = /* @__PURE__ */ new Map();
  const next = async () => {
    while (true) {
      if (waitUntil2 > performance.now()) {
        await wait(Math.max(1, waitUntil2 - performance.now() + 1));
      } else if (queue.length === 0) {
        const uuid = generateUuid();
        await new Promise((resolve) => {
          addedToQueueCallbacks.set(uuid, resolve);
        });
        addedToQueueCallbacks.delete(uuid);
      } else {
        break;
      }
    }
    const nextFuncs = options.batchCalls ? queue.splice(0, queue.length) : [queue.shift()];
    const start = performance.now();
    const value = await Result.fromPromise(func());
    const end = performance.now();
    waitUntil2 = Math.max(
      waitUntil2,
      start + (options.throttleMs ?? 0),
      end + (options.gapMs ?? 0)
    );
    for (const nextFunc of nextFuncs) {
      if (value.status === "ok") {
        nextFunc[0](value.data);
      } else {
        nextFunc[1](value.error);
      }
    }
  };
  runAsynchronously(async () => {
    while (true) {
      await next();
    }
  });
  return () => {
    return new Promise((resolve, reject) => {
      waitUntil2 = Math.max(
        waitUntil2,
        performance.now() + (options.debounceMs ?? 0)
      );
      queue.push([resolve, reject]);
      addedToQueueCallbacks.forEach((cb) => cb());
    });
  };
}
function throttled(func, delayMs) {
  let timeout2 = null;
  let nextAvailable = null;
  return async (...args) => {
    while (nextAvailable !== null) {
      await nextAvailable;
    }
    nextAvailable = new Promise((resolve) => {
      timeout2 = setTimeout(() => {
        nextAvailable = null;
        resolve(func(...args));
      }, delayMs);
    });
    return await nextAvailable;
  };
}
export {
  createPromise,
  ignoreUnhandledRejection,
  neverResolve,
  pending,
  rateLimited,
  rejected,
  resolved,
  runAsynchronously,
  runAsynchronouslyWithAlert,
  throttled,
  timeout,
  timeoutThrow,
  wait,
  waitUntil
};
//# sourceMappingURL=promises.js.map