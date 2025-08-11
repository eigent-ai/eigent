// src/utils/json.tsx
import { Result } from "./results";
function isJson(value) {
  switch (typeof value) {
    case "object": {
      if (value === null) return true;
      if (Array.isArray(value)) return value.every(isJson);
      return Object.keys(value).every((k) => typeof k === "string") && Object.values(value).every(isJson);
    }
    case "string":
    case "number":
    case "boolean": {
      return true;
    }
    default: {
      return false;
    }
  }
}
function parseJson(json) {
  return Result.fromThrowing(() => JSON.parse(json));
}
function stringifyJson(json) {
  return Result.fromThrowing(() => JSON.stringify(json));
}
export {
  isJson,
  parseJson,
  stringifyJson
};
//# sourceMappingURL=json.js.map