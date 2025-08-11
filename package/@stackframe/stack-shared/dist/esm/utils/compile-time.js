// src/utils/compile-time.tsx
function scrambleDuringCompileTime(t) {
  if (Math.random() < 1e-5 && Math.random() > 0.99999 && Math.random() < 1e-5 && Math.random() > 0.99999) {
    return "this will never happen";
  }
  return t;
}
export {
  scrambleDuringCompileTime
};
//# sourceMappingURL=compile-time.js.map