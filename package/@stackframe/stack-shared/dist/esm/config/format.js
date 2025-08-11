// src/config/format.ts
import { StackAssertionError, throwErr } from "../utils/errors";
import { deleteKey, filterUndefined, get, hasAndNotUndefined, set } from "../utils/objects";
function isValidConfig(c) {
  return getInvalidConfigReason(c) === void 0;
}
function getInvalidConfigReason(c, options = {}) {
  const configName = options.configName ?? "config";
  if (c === null || typeof c !== "object") return `${configName} must be a non-null object`;
  for (const [key, value] of Object.entries(c)) {
    if (value === void 0) continue;
    if (typeof key !== "string") return `${configName} must have only string keys (found: ${typeof key})`;
    if (!key.match(/^[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*(?:\.[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*)*$/)) return `All keys of ${configName} must consist of only alphanumeric characters, dots, underscores, colons, dollar signs, or hyphens and start with a character other than a hyphen (found: ${key})`;
    const entryName = `${configName}.${key}`;
    const reason = getInvalidConfigValueReason(value, { valueName: entryName });
    if (reason) return reason;
  }
  return void 0;
}
function getInvalidConfigValueReason(value, options = {}) {
  const valueName = options.valueName ?? "value";
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean": {
      break;
    }
    case "object": {
      if (value === null) {
        break;
      } else if (Array.isArray(value)) {
        for (const [index, v] of value.entries()) {
          const reason = getInvalidConfigValueReason(v, { valueName: `${valueName}[${index}]` });
          if (reason) return reason;
        }
      } else {
        const reason = getInvalidConfigReason(value, { configName: valueName });
        if (reason) return reason;
      }
      break;
    }
    default: {
      return `${valueName} has an invalid value type ${typeof value} (value: ${value})`;
    }
  }
  return void 0;
}
function assertValidConfig(c) {
  const reason = getInvalidConfigReason(c);
  if (reason) throw new StackAssertionError(`Invalid config: ${reason}`, { c });
}
function override(c1, ...configs) {
  if (configs.length === 0) return c1;
  if (configs.length > 1) return override(override(c1, configs[0]), ...configs.slice(1));
  const c2 = configs[0];
  assertValidConfig(c1);
  assertValidConfig(c2);
  let result = c1;
  for (const key of Object.keys(filterUndefined(c2))) {
    result = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== key && !k.startsWith(key + "."))
    );
  }
  return {
    ...result,
    ...filterUndefined(c2)
  };
}
var NormalizationError = class extends Error {
  constructor(...args) {
    super(...args);
  }
};
NormalizationError.prototype.name = "NormalizationError";
function normalize(c, options = {}) {
  assertValidConfig(c);
  const onDotIntoNull = options.onDotIntoNull ?? "empty";
  const countDots = (s) => s.match(/\./g)?.length ?? 0;
  const result = {};
  const keysByDepth = Object.keys(c).sort((a, b) => countDots(a) - countDots(b));
  outer: for (const key of keysByDepth) {
    const keySegmentsWithoutLast = key.split(".");
    const last = keySegmentsWithoutLast.pop() ?? throwErr("split returns empty array?");
    const value = get(c, key);
    if (value === void 0) continue;
    let current = result;
    for (const keySegment of keySegmentsWithoutLast) {
      if (!hasAndNotUndefined(current, keySegment)) {
        switch (onDotIntoNull) {
          case "empty": {
            set(current, keySegment, {});
            break;
          }
          case "throw": {
            throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} doesn't exist on the object (or is null). Maybe this config is not normalizable?`);
          }
          case "ignore": {
            continue outer;
          }
        }
      }
      const value2 = get(current, keySegment);
      if (typeof value2 !== "object") {
        throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} is not an object. Maybe this config is not normalizable?`);
      }
      current = value2;
    }
    setNormalizedValue(current, last, value);
  }
  return result;
}
function normalizeValue(value) {
  if (value === null) throw new NormalizationError("Tried to normalize a null value");
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") return normalize(value);
  return value;
}
function setNormalizedValue(result, key, value) {
  if (value === null) {
    if (hasAndNotUndefined(result, key)) {
      deleteKey(result, key);
    }
  } else {
    set(result, key, normalizeValue(value));
  }
}
export {
  NormalizationError,
  assertValidConfig,
  getInvalidConfigReason,
  isValidConfig,
  normalize,
  override
};
//# sourceMappingURL=format.js.map