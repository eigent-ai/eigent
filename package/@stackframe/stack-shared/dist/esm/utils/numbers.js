// src/utils/numbers.tsx
var magnitudes = [
  [1e15, "trln"],
  [1e12, "bln"],
  [1e9, "bn"],
  [1e6, "M"],
  [1e3, "k"]
];
function prettyPrintWithMagnitudes(num) {
  if (typeof num !== "number") throw new Error("Expected a number");
  if (Number.isNaN(num)) return "NaN";
  if (num < 0) return "-" + prettyPrintWithMagnitudes(-num);
  if (!Number.isFinite(num)) return "\u221E";
  for (const [magnitude, suffix] of magnitudes) {
    if (num >= magnitude) {
      return toFixedMax(num / magnitude, 1) + suffix;
    }
  }
  return toFixedMax(num, 1);
}
function toFixedMax(num, maxDecimals) {
  return num.toFixed(maxDecimals).replace(/\.?0+$/, "");
}
function numberCompare(a, b) {
  return Math.sign(a - b);
}
export {
  numberCompare,
  prettyPrintWithMagnitudes,
  toFixedMax
};
//# sourceMappingURL=numbers.js.map