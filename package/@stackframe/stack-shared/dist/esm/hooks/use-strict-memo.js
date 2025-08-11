// src/hooks/use-strict-memo.tsx
import { useId, useInsertionEffect } from "react";
import { Result } from "../utils/results";
var cached = /* @__PURE__ */ new Map();
function unwrapFromInner(dependencies, inner) {
  if (dependencies.length === 0 !== "isNotNestedMap" in inner) {
    return Result.error(void 0);
  }
  if ("isNotNestedMap" in inner) {
    if (dependencies.length === 0) {
      return Result.ok(inner.value);
    } else {
      return Result.error(void 0);
    }
  } else {
    if (dependencies.length === 0) {
      return Result.error(void 0);
    } else {
      const [key, ...rest] = dependencies;
      const newInner = inner.get(key);
      if (!newInner) {
        return Result.error(void 0);
      }
      return unwrapFromInner(rest, newInner);
    }
  }
}
function wrapToInner(dependencies, value) {
  if (dependencies.length === 0) {
    return { isNotNestedMap: true, value };
  }
  const [key, ...rest] = dependencies;
  const inner = wrapToInner(rest, value);
  const isObject = typeof key === "object" && key !== null;
  const isUnregisteredSymbol = typeof key === "symbol" && Symbol.keyFor(key) === void 0;
  const isWeak = isObject || isUnregisteredSymbol;
  const mapType = isWeak ? WeakMap : Map;
  return new mapType([[key, inner]]);
}
function useStrictMemo(callback, dependencies) {
  const id = useId();
  useInsertionEffect(() => {
    return () => {
      cached.delete(id);
    };
  }, [id]);
  const c = cached.get(id);
  if (c) {
    const unwrapped = unwrapFromInner(dependencies, c);
    if (unwrapped.status === "ok") {
      return unwrapped.data;
    }
  }
  const value = callback();
  cached.set(id, wrapToInner(dependencies, value));
  return value;
}
export {
  useStrictMemo
};
//# sourceMappingURL=use-strict-memo.js.map