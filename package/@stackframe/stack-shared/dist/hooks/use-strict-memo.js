"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/hooks/use-strict-memo.tsx
var use_strict_memo_exports = {};
__export(use_strict_memo_exports, {
  useStrictMemo: () => useStrictMemo
});
module.exports = __toCommonJS(use_strict_memo_exports);
var import_react = require("react");
var import_results = require("../utils/results");
var cached = /* @__PURE__ */ new Map();
function unwrapFromInner(dependencies, inner) {
  if (dependencies.length === 0 !== "isNotNestedMap" in inner) {
    return import_results.Result.error(void 0);
  }
  if ("isNotNestedMap" in inner) {
    if (dependencies.length === 0) {
      return import_results.Result.ok(inner.value);
    } else {
      return import_results.Result.error(void 0);
    }
  } else {
    if (dependencies.length === 0) {
      return import_results.Result.error(void 0);
    } else {
      const [key, ...rest] = dependencies;
      const newInner = inner.get(key);
      if (!newInner) {
        return import_results.Result.error(void 0);
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
  const id = (0, import_react.useId)();
  (0, import_react.useInsertionEffect)(() => {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useStrictMemo
});
//# sourceMappingURL=use-strict-memo.js.map