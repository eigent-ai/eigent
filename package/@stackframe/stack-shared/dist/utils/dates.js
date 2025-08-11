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

// src/utils/dates.tsx
var dates_exports = {};
__export(dates_exports, {
  fromNow: () => fromNow,
  fromNowDetailed: () => fromNowDetailed,
  getInputDatetimeLocalString: () => getInputDatetimeLocalString,
  isWeekend: () => isWeekend
});
module.exports = __toCommonJS(dates_exports);
var import_math = require("./math");
function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}
var agoUnits = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [5, "week"]
];
function fromNow(date) {
  return fromNowDetailed(date).result;
}
function fromNowDetailed(date) {
  if (!(date instanceof Date)) {
    throw new Error(`fromNow only accepts Date objects (received: ${date})`);
  }
  const now = /* @__PURE__ */ new Date();
  const elapsed = now.getTime() - date.getTime();
  let remainingInUnit = Math.abs(elapsed) / 1e3;
  if (remainingInUnit < 15) {
    return {
      result: "just now",
      secondsUntilChange: 15 - remainingInUnit
    };
  }
  let unitInSeconds = 1;
  for (const [nextUnitSize, unitName] of agoUnits) {
    const rounded = Math.round(remainingInUnit);
    if (rounded < nextUnitSize) {
      if (elapsed < 0) {
        return {
          result: `in ${rounded} ${unitName}${rounded === 1 ? "" : "s"}`,
          secondsUntilChange: (0, import_math.remainder)((remainingInUnit - rounded + 0.5) * unitInSeconds, unitInSeconds)
        };
      } else {
        return {
          result: `${rounded} ${unitName}${rounded === 1 ? "" : "s"} ago`,
          secondsUntilChange: (0, import_math.remainder)((rounded - remainingInUnit - 0.5) * unitInSeconds, unitInSeconds)
        };
      }
    }
    unitInSeconds *= nextUnitSize;
    remainingInUnit /= nextUnitSize;
  }
  return {
    result: date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    secondsUntilChange: Infinity
  };
}
function getInputDatetimeLocalString(date) {
  date = new Date(date);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 19);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fromNow,
  fromNowDetailed,
  getInputDatetimeLocalString,
  isWeekend
});
//# sourceMappingURL=dates.js.map