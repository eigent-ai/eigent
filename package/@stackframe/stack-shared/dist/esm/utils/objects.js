// src/utils/objects.tsx
import { StackAssertionError } from "./errors";
import { identity } from "./functions";
import { stringCompare } from "./strings";
function isNotNull(value) {
  return value !== null && value !== void 0;
}
function deepPlainEquals(obj1, obj2, options = {}) {
  if (typeof obj1 !== typeof obj2) return false;
  if (obj1 === obj2) return true;
  switch (typeof obj1) {
    case "object": {
      if (!obj1 || !obj2) return false;
      if (Array.isArray(obj1) || Array.isArray(obj2)) {
        if (!Array.isArray(obj1) || !Array.isArray(obj2)) return false;
        if (obj1.length !== obj2.length) return false;
        return obj1.every((v, i) => deepPlainEquals(v, obj2[i], options));
      }
      const entries1 = Object.entries(obj1).filter(([k, v]) => !options.ignoreUndefinedValues || v !== void 0);
      const entries2 = Object.entries(obj2).filter(([k, v]) => !options.ignoreUndefinedValues || v !== void 0);
      if (entries1.length !== entries2.length) return false;
      return entries1.every(([k, v1]) => {
        const e2 = entries2.find(([k2]) => k === k2);
        if (!e2) return false;
        return deepPlainEquals(v1, e2[1], options);
      });
    }
    case "undefined":
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "function": {
      return false;
    }
    default: {
      throw new Error("Unexpected typeof " + typeof obj1);
    }
  }
}
function isCloneable(obj) {
  return typeof obj !== "symbol" && typeof obj !== "function";
}
function shallowClone(obj) {
  if (!isCloneable(obj)) throw new StackAssertionError("shallowClone does not support symbols or functions", { obj });
  if (Array.isArray(obj)) return obj.map(identity);
  return { ...obj };
}
function deepPlainClone(obj) {
  if (typeof obj === "function") throw new StackAssertionError("deepPlainClone does not support functions");
  if (typeof obj === "symbol") throw new StackAssertionError("deepPlainClone does not support symbols");
  if (typeof obj !== "object" || !obj) return obj;
  if (Array.isArray(obj)) return obj.map(deepPlainClone);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deepPlainClone(v)]));
}
function deepMerge(baseObj, mergeObj) {
  if ([baseObj, mergeObj, ...Object.values(baseObj), ...Object.values(mergeObj)].some((o) => !isCloneable(o))) throw new StackAssertionError("deepMerge does not support functions or symbols", { baseObj, mergeObj });
  const res = shallowClone(baseObj);
  for (const [key, mergeValue] of Object.entries(mergeObj)) {
    if (has(res, key)) {
      const baseValue = get(res, key);
      if (isObjectLike(baseValue) && isObjectLike(mergeValue)) {
        set(res, key, deepMerge(baseValue, mergeValue));
        continue;
      }
    }
    set(res, key, mergeValue);
  }
  return res;
}
function typedEntries(obj) {
  return Object.entries(obj);
}
function typedFromEntries(entries) {
  return Object.fromEntries(entries);
}
function typedKeys(obj) {
  return Object.keys(obj);
}
function typedValues(obj) {
  return Object.values(obj);
}
function typedAssign(target, source) {
  return Object.assign(target, source);
}
function filterUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== void 0));
}
function filterUndefinedOrNull(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== void 0 && v !== null));
}
function deepFilterUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== void 0).map(([k, v]) => [k, isObjectLike(v) ? deepFilterUndefined(v) : v]));
}
function pick(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
}
function omit(obj, keys) {
  if (!Array.isArray(keys)) throw new StackAssertionError("omit: keys must be an array", { obj, keys });
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}
function split(obj, keys) {
  return [pick(obj, keys), omit(obj, keys)];
}
function mapValues(obj, fn) {
  if (Array.isArray(obj)) {
    return obj.map((v) => fn(v));
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}
function sortKeys(obj) {
  if (Array.isArray(obj)) {
    return [...obj];
  }
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => stringCompare(a, b)));
}
function deepSortKeys(obj) {
  return sortKeys(mapValues(obj, (v) => isObjectLike(v) ? deepSortKeys(v) : v));
}
function set(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: true });
}
function get(obj, key) {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor) throw new StackAssertionError(`get: key ${String(key)} does not exist`, { obj, key });
  return descriptor.value;
}
function getOrUndefined(obj, key) {
  return has(obj, key) ? get(obj, key) : void 0;
}
function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function hasAndNotUndefined(obj, key) {
  return has(obj, key) && get(obj, key) !== void 0;
}
function deleteKey(obj, key) {
  if (has(obj, key)) {
    Reflect.deleteProperty(obj, key);
  } else {
    throw new StackAssertionError(`deleteKey: key ${String(key)} does not exist`, { obj, key });
  }
}
function isObjectLike(value) {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}
export {
  deepFilterUndefined,
  deepMerge,
  deepPlainClone,
  deepPlainEquals,
  deepSortKeys,
  deleteKey,
  filterUndefined,
  filterUndefinedOrNull,
  get,
  getOrUndefined,
  has,
  hasAndNotUndefined,
  isCloneable,
  isNotNull,
  isObjectLike,
  mapValues,
  omit,
  pick,
  set,
  shallowClone,
  sortKeys,
  split,
  typedAssign,
  typedEntries,
  typedFromEntries,
  typedKeys,
  typedValues
};
//# sourceMappingURL=objects.js.map