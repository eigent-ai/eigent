// src/utils/strings.tsx
import { findLastIndex, unique } from "./arrays";
import { StackAssertionError } from "./errors";
import { filterUndefined } from "./objects";
function typedToLowercase(s) {
  if (typeof s !== "string") throw new StackAssertionError("Expected a string for typedToLowercase", { s });
  return s.toLowerCase();
}
function typedToUppercase(s) {
  if (typeof s !== "string") throw new StackAssertionError("Expected a string for typedToUppercase", { s });
  return s.toUpperCase();
}
function typedCapitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function stringCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") throw new StackAssertionError(`Expected two strings for stringCompare, found ${typeof a} and ${typeof b}`, { a, b });
  const cmp = (a2, b2) => a2 < b2 ? -1 : a2 > b2 ? 1 : 0;
  return cmp(a.toUpperCase(), b.toUpperCase()) || cmp(b, a);
}
function getWhitespacePrefix(s) {
  return s.substring(0, s.length - s.trimStart().length);
}
function getWhitespaceSuffix(s) {
  return s.substring(s.trimEnd().length);
}
function trimEmptyLinesStart(s) {
  const lines = s.split("\n");
  const firstNonEmptyLineIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstNonEmptyLineIndex === -1) return "";
  return lines.slice(firstNonEmptyLineIndex).join("\n");
}
function trimEmptyLinesEnd(s) {
  const lines = s.split("\n");
  const lastNonEmptyLineIndex = findLastIndex(lines, (line) => line.trim() !== "");
  return lines.slice(0, lastNonEmptyLineIndex + 1).join("\n");
}
function trimLines(s) {
  return trimEmptyLinesEnd(trimEmptyLinesStart(s));
}
function templateIdentity(strings, ...values) {
  if (values.length !== strings.length - 1) throw new StackAssertionError("Invalid number of values; must be one less than strings", { strings, values });
  return strings.reduce((result, str, i) => result + str + (values[i] ?? ""), "");
}
function deindent(strings, ...values) {
  if (typeof strings === "string") return deindent([strings]);
  return templateIdentity(...deindentTemplate(strings, ...values));
}
function deindentTemplate(strings, ...values) {
  if (values.length !== strings.length - 1) throw new StackAssertionError("Invalid number of values; must be one less than strings", { strings, values });
  const trimmedStrings = [...strings];
  trimmedStrings[0] = trimEmptyLinesStart(trimmedStrings[0] + "+").slice(0, -1);
  trimmedStrings[trimmedStrings.length - 1] = trimEmptyLinesEnd("+" + trimmedStrings[trimmedStrings.length - 1]).slice(1);
  const indentation = trimmedStrings.join("${SOME_VALUE}").split("\n").filter((line) => line.trim() !== "").map((line) => getWhitespacePrefix(line).length).reduce((min, current) => Math.min(min, current), Infinity);
  const deindentedStrings = trimmedStrings.map((string, stringIndex) => {
    return string.split("\n").map((line, lineIndex) => stringIndex !== 0 && lineIndex === 0 ? line : line.substring(indentation)).join("\n");
  });
  const indentedValues = values.map((value, i) => {
    const firstLineIndentation = getWhitespacePrefix(deindentedStrings[i].split("\n").at(-1));
    return `${value}`.replaceAll("\n", `
${firstLineIndentation}`);
  });
  return [deindentedStrings, ...indentedValues];
}
function extractScopes(scope, removeDuplicates = true) {
  const trimmedString = scope.trim();
  const scopesArray = trimmedString.split(/\s+/);
  const filtered = scopesArray.filter((scope2) => scope2.length > 0);
  return removeDuplicates ? [...new Set(filtered)] : filtered;
}
function mergeScopeStrings(...scopes) {
  const allScope = scopes.map((s) => extractScopes(s)).flat().join(" ");
  return extractScopes(allScope).join(" ");
}
function escapeTemplateLiteral(s) {
  return s.replaceAll("`", "\\`").replaceAll("\\", "\\\\").replaceAll("$", "\\$");
}
var nicifiableClassNameOverrides = new Map(Object.entries({
  Headers
}).map(([k, v]) => [v, k]));
function nicify(value, options = {}) {
  const fullOptions = {
    maxDepth: 5,
    currentIndent: "",
    lineIndent: "  ",
    multiline: true,
    refs: /* @__PURE__ */ new Map(),
    path: "value",
    parent: null,
    overrides: () => null,
    keyInParent: null,
    hideFields: [],
    ...filterUndefined(options)
  };
  const {
    maxDepth,
    currentIndent,
    lineIndent,
    multiline,
    refs,
    path,
    overrides,
    hideFields
  } = fullOptions;
  const nl = `
${currentIndent}`;
  const overrideResult = overrides(value, options);
  if (overrideResult !== null) return overrideResult;
  if (["function", "object", "symbol"].includes(typeof value) && value !== null) {
    if (refs.has(value)) {
      return `Ref<${refs.get(value)}>`;
    }
    refs.set(value, path);
  }
  const newOptions = {
    maxDepth: maxDepth - 1,
    currentIndent,
    lineIndent,
    multiline,
    refs,
    path: path + "->[unknown property]",
    overrides,
    parent: { value, options: fullOptions },
    keyInParent: null,
    hideFields: []
  };
  const nestedNicify = (newValue, newPath, keyInParent, options2 = {}) => {
    return nicify(newValue, {
      ...newOptions,
      path: newPath,
      currentIndent: currentIndent + lineIndent,
      keyInParent,
      ...options2
    });
  };
  switch (typeof value) {
    case "boolean":
    case "number": {
      return JSON.stringify(value);
    }
    case "string": {
      const isDeindentable = (v) => deindent(v) === v && v.includes("\n");
      const wrapInDeindent = (v) => deindent`
        deindent\`
        ${currentIndent + lineIndent}${escapeTemplateLiteral(v).replaceAll("\n", nl + lineIndent)}
        ${currentIndent}\`
      `;
      if (isDeindentable(value)) {
        return wrapInDeindent(value);
      } else if (value.endsWith("\n") && isDeindentable(value.slice(0, -1))) {
        return wrapInDeindent(value.slice(0, -1)) + ' + "\\n"';
      } else {
        return JSON.stringify(value);
      }
    }
    case "undefined": {
      return "undefined";
    }
    case "symbol": {
      return value.toString();
    }
    case "bigint": {
      return `${value}n`;
    }
    case "function": {
      if (value.name) return `function ${value.name}(...) { ... }`;
      return `(...) => { ... }`;
    }
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) {
        const extraLines2 = getNicifiedObjectExtraLines(value);
        const resValueLength2 = value.length + extraLines2.length;
        if (maxDepth <= 0 && resValueLength2 === 0) return "[...]";
        const resValues2 = value.map((v, i) => nestedNicify(v, `${path}[${i}]`, i));
        resValues2.push(...extraLines2);
        if (resValues2.length !== resValueLength2) throw new StackAssertionError("nicify of object: resValues.length !== resValueLength", { value, resValues: resValues2, resValueLength: resValueLength2 });
        const shouldIndent2 = resValues2.length > 4 || resValues2.some((x) => resValues2.length > 1 && x.length > 4 || x.includes("\n"));
        if (shouldIndent2) {
          return `[${nl}${resValues2.map((x) => `${lineIndent}${x},${nl}`).join("")}]`;
        } else {
          return `[${resValues2.join(", ")}]`;
        }
      }
      if (value instanceof URL) {
        return `URL(${nestedNicify(value.toString(), `${path}.toString()`, null)})`;
      }
      if (ArrayBuffer.isView(value)) {
        return `${value.constructor.name}([${value.toString()}])`;
      }
      if (value instanceof Error) {
        let stack = value.stack ?? "";
        const toString = value.toString();
        if (!stack.startsWith(toString)) stack = `${toString}
${stack}`;
        stack = stack.trimEnd();
        stack = stack.replace(/\n\s+/g, `
${lineIndent}${lineIndent}`);
        stack = stack.replace("\n", `
${lineIndent}Stack:
`);
        if (Object.keys(value).length > 0) {
          stack += `
${lineIndent}Extra properties: ${nestedNicify(Object.fromEntries(Object.entries(value)), path, null)}`;
        }
        if (value.cause) {
          stack += `
${lineIndent}Cause:
${lineIndent}${lineIndent}${nestedNicify(value.cause, path, null, { currentIndent: currentIndent + lineIndent + lineIndent })}`;
        }
        stack = stack.replaceAll("\n", `
${currentIndent}`);
        return stack;
      }
      const constructorName = [null, Object.prototype].includes(Object.getPrototypeOf(value)) ? null : nicifiableClassNameOverrides.get(value.constructor) ?? value.constructor.name;
      const constructorString = constructorName ? `${constructorName} ` : "";
      const entries = getNicifiableEntries(value).filter(([k]) => !hideFields.includes(k));
      const extraLines = [
        ...getNicifiedObjectExtraLines(value),
        ...hideFields.length > 0 ? [`<some fields may have been hidden>`] : []
      ];
      const resValueLength = entries.length + extraLines.length;
      if (resValueLength === 0) return `${constructorString}{}`;
      if (maxDepth <= 0) return `${constructorString}{ ... }`;
      const resValues = entries.map(([k, v], keyIndex) => {
        const keyNicified = nestedNicify(k, `Object.keys(${path})[${keyIndex}]`, null);
        const keyInObjectLiteral = typeof k === "string" ? nicifyPropertyString(k) : `[${keyNicified}]`;
        if (typeof v === "function" && v.name === k) {
          return `${keyInObjectLiteral}(...): { ... }`;
        } else {
          return `${keyInObjectLiteral}: ${nestedNicify(v, `${path}[${keyNicified}]`, k)}`;
        }
      });
      resValues.push(...extraLines);
      if (resValues.length !== resValueLength) throw new StackAssertionError("nicify of object: resValues.length !== resValueLength", { value, resValues, resValueLength });
      const shouldIndent = resValues.length > 1 || resValues.some((x) => x.includes("\n"));
      if (resValues.length === 0) return `${constructorString}{}`;
      if (shouldIndent) {
        return `${constructorString}{${nl}${resValues.map((x) => `${lineIndent}${x},${nl}`).join("")}}`;
      } else {
        return `${constructorString}{ ${resValues.join(", ")} }`;
      }
    }
    default: {
      return `${typeof value}<${value}>`;
    }
  }
}
function replaceAll(input, searchValue, replaceValue) {
  if (searchValue === "") throw new StackAssertionError("replaceAll: searchValue is empty");
  return input.split(searchValue).join(replaceValue);
}
function nicifyPropertyString(str) {
  return JSON.stringify(str);
}
function getNicifiableKeys(value) {
  const overridden = ("getNicifiableKeys" in value ? value.getNicifiableKeys?.bind(value) : null)?.();
  if (overridden != null) return overridden;
  const keys = Object.keys(value).sort();
  return unique(keys);
}
function getNicifiableEntries(value) {
  const recordLikes = [Headers];
  function isRecordLike(value2) {
    return recordLikes.some((x) => value2 instanceof x);
  }
  if (isRecordLike(value)) {
    return [...value.entries()].sort(([a], [b]) => stringCompare(`${a}`, `${b}`));
  }
  const keys = getNicifiableKeys(value);
  return keys.map((k) => [k, value[k]]);
}
function getNicifiedObjectExtraLines(value) {
  return ("getNicifiedObjectExtraLines" in value ? value.getNicifiedObjectExtraLines : null)?.() ?? [];
}
export {
  deindent,
  deindentTemplate,
  escapeTemplateLiteral,
  extractScopes,
  getWhitespacePrefix,
  getWhitespaceSuffix,
  mergeScopeStrings,
  nicify,
  replaceAll,
  stringCompare,
  templateIdentity,
  trimEmptyLinesEnd,
  trimEmptyLinesStart,
  trimLines,
  typedCapitalize,
  typedToLowercase,
  typedToUppercase
};
//# sourceMappingURL=strings.js.map