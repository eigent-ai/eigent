// src/utils/globals.tsx
var globalVar = typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {};
if (typeof globalThis === "undefined") {
  globalVar.globalThis = globalVar;
}
var stackGlobalsSymbol = Symbol.for("__stack-globals");
globalVar[stackGlobalsSymbol] ??= {};
function createGlobal(key, init) {
  if (!globalVar[stackGlobalsSymbol][key]) {
    globalVar[stackGlobalsSymbol][key] = init();
  }
  return globalVar[stackGlobalsSymbol][key];
}
export {
  createGlobal,
  globalVar
};
//# sourceMappingURL=globals.js.map