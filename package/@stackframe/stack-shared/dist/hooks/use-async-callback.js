"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/hooks/use-async-callback.tsx
var use_async_callback_exports = {};
__export(use_async_callback_exports, {
  useAsyncCallback: () => useAsyncCallback,
  useAsyncCallbackWithLoggedError: () => useAsyncCallbackWithLoggedError
});
module.exports = __toCommonJS(use_async_callback_exports);
var import_react = __toESM(require("react"));
var import_errors = require("../utils/errors");
function useAsyncCallback(callback, deps) {
  const [error, setError] = import_react.default.useState(void 0);
  const [loadingCount, setLoadingCount] = import_react.default.useState(0);
  const cb = import_react.default.useCallback(
    async (...args) => {
      setLoadingCount((c) => c + 1);
      try {
        return await callback(...args);
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setLoadingCount((c) => c - 1);
      }
    },
    deps
  );
  return [cb, loadingCount > 0, error];
}
function useAsyncCallbackWithLoggedError(callback, deps) {
  const [newCallback, loading] = useAsyncCallback(async (...args) => {
    try {
      return await callback(...args);
    } catch (e) {
      (0, import_errors.captureError)("async-callback", e);
      throw e;
    }
  }, deps);
  return [newCallback, loading];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useAsyncCallback,
  useAsyncCallbackWithLoggedError
});
//# sourceMappingURL=use-async-callback.js.map