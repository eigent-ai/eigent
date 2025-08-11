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

// src/hooks/use-async-external-store.tsx
var use_async_external_store_exports = {};
__export(use_async_external_store_exports, {
  useAsyncExternalStore: () => useAsyncExternalStore
});
module.exports = __toCommonJS(use_async_external_store_exports);
var import_react = require("react");
var import_results = require("../utils/results");
function useAsyncExternalStore(subscribe) {
  const [isAvailable, setIsAvailable] = (0, import_react.useState)(false);
  const [value, setValue] = (0, import_react.useState)();
  (0, import_react.useEffect)(() => {
    const unsubscribe = subscribe((value2) => {
      setValue(() => value2);
      setIsAvailable(() => true);
    });
    return unsubscribe;
  }, [subscribe]);
  if (isAvailable) {
    return import_results.AsyncResult.ok(value);
  } else {
    return import_results.AsyncResult.pending();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useAsyncExternalStore
});
//# sourceMappingURL=use-async-external-store.js.map