// src/utils/browser-compat.tsx
function getBrowserCompatibilityReport() {
  const test = (snippet) => {
    try {
      (0, eval)(snippet);
      return true;
    } catch (e) {
      return `FAILED: ${e}`;
    }
  };
  return {
    optionalChaining: test("({})?.b?.c"),
    nullishCoalescing: test("0 ?? 1"),
    weakRef: test("new WeakRef({})"),
    cryptoUuid: test("crypto.randomUUID()")
  };
}
export {
  getBrowserCompatibilityReport
};
//# sourceMappingURL=browser-compat.js.map