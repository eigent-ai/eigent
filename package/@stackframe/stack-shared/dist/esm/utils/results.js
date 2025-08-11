// src/utils/results.tsx
import { wait } from "./promises";
import { deindent, nicify } from "./strings";
var Result = {
  fromThrowing,
  fromThrowingAsync,
  fromPromise: promiseToResult,
  ok(data) {
    return {
      status: "ok",
      data
    };
  },
  error(error) {
    return {
      status: "error",
      error
    };
  },
  map: mapResult,
  or: (result, fallback) => {
    return result.status === "ok" ? result.data : fallback;
  },
  orThrow: (result) => {
    if (result.status === "error") {
      throw result.error;
    }
    return result.data;
  },
  orThrowAsync: async (result) => {
    return Result.orThrow(await result);
  },
  retry
};
var AsyncResult = {
  fromThrowing,
  fromPromise: promiseToResult,
  ok: Result.ok,
  error: Result.error,
  pending,
  map: mapResult,
  or: (result, fallback) => {
    if (result.status === "pending") {
      return fallback;
    }
    return Result.or(result, fallback);
  },
  orThrow: (result) => {
    if (result.status === "pending") {
      throw new Error("Result still pending");
    }
    return Result.orThrow(result);
  },
  retry
};
function pending(progress) {
  return {
    status: "pending",
    progress
  };
}
async function promiseToResult(promise) {
  try {
    const value = await promise;
    return Result.ok(value);
  } catch (error) {
    return Result.error(error);
  }
}
function fromThrowing(fn) {
  try {
    return Result.ok(fn());
  } catch (error) {
    return Result.error(error);
  }
}
async function fromThrowingAsync(fn) {
  try {
    return Result.ok(await fn());
  } catch (error) {
    return Result.error(error);
  }
}
function mapResult(result, fn) {
  if (result.status === "error") return {
    status: "error",
    error: result.error
  };
  if (result.status === "pending") return {
    status: "pending",
    ..."progress" in result ? { progress: result.progress } : {}
  };
  return Result.ok(fn(result.data));
}
var RetryError = class extends AggregateError {
  constructor(errors) {
    const strings = errors.map((e) => nicify(e));
    const isAllSame = strings.length > 1 && strings.every((s) => s === strings[0]);
    super(
      errors,
      deindent`
      Error after ${errors.length} attempts.
      
      ${isAllSame ? deindent`
        Attempts 1-${errors.length}:
          ${strings[0]}
      ` : strings.map((s, i) => deindent`
          Attempt ${i + 1}:
            ${s}
        `).join("\n\n")}
      `,
      { cause: errors[errors.length - 1] }
    );
    this.errors = errors;
    this.name = "RetryError";
  }
  get attempts() {
    return this.errors.length;
  }
};
RetryError.prototype.name = "RetryError";
async function retry(fn, totalAttempts, { exponentialDelayBase = 1e3 } = {}) {
  const errors = [];
  for (let i = 0; i < totalAttempts; i++) {
    const res = await fn(i);
    if (res.status === "ok") {
      return Object.assign(Result.ok(res.data), { attempts: i + 1 });
    } else {
      errors.push(res.error);
      if (i < totalAttempts - 1) {
        await wait((Math.random() + 0.5) * exponentialDelayBase * 2 ** i);
      }
    }
  }
  return Object.assign(Result.error(new RetryError(errors)), { attempts: totalAttempts });
}
export {
  AsyncResult,
  Result
};
//# sourceMappingURL=results.js.map