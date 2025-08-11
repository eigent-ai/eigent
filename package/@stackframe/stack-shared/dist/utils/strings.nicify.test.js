"use strict";

// src/utils/strings.nicify.test.ts
var import_vitest = require("vitest");
var import_strings = require("./strings");
(0, import_vitest.describe)("nicify", () => {
  (0, import_vitest.describe)("primitive values", () => {
    (0, import_vitest.test)("numbers", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(123)).toBe("123");
      (0, import_vitest.expect)((0, import_strings.nicify)(123n)).toBe("123n");
    });
    (0, import_vitest.test)("strings", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)("hello")).toBe('"hello"');
    });
    (0, import_vitest.test)("booleans", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(true)).toBe("true");
      (0, import_vitest.expect)((0, import_strings.nicify)(false)).toBe("false");
    });
    (0, import_vitest.test)("null and undefined", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(null)).toBe("null");
      (0, import_vitest.expect)((0, import_strings.nicify)(void 0)).toBe("undefined");
    });
    (0, import_vitest.test)("symbols", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(Symbol("test"))).toBe("Symbol(test)");
    });
  });
  (0, import_vitest.describe)("arrays", () => {
    (0, import_vitest.test)("empty array", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)([])).toBe("[]");
    });
    (0, import_vitest.test)("single-element array", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)([1])).toBe("[1]");
    });
    (0, import_vitest.test)("single-element array with long content", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(["123123123123123"])).toBe('["123123123123123"]');
    });
    (0, import_vitest.test)("flat array", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)([1, 2, 3])).toBe("[1, 2, 3]");
    });
    (0, import_vitest.test)("longer array", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)([1e4, 2, 3])).toBe(import_strings.deindent`
        [
          10000,
          2,
          3,
        ]
      `);
    });
    (0, import_vitest.test)("nested array", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)([1, [2, 3]])).toBe(import_strings.deindent`
        [
          1,
          [2, 3],
        ]
      `);
    });
  });
  (0, import_vitest.describe)("objects", () => {
    (0, import_vitest.test)("empty object", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({})).toBe("{}");
    });
    (0, import_vitest.test)("simple object", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({ a: 1 })).toBe('{ "a": 1 }');
    });
    (0, import_vitest.test)("multiline object", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({ a: 1, b: 2 })).toBe(import_strings.deindent`
        {
          "a": 1,
          "b": 2,
        }
      `);
    });
  });
  (0, import_vitest.describe)("custom classes", () => {
    (0, import_vitest.test)("class instance", () => {
      class TestClass {
        constructor(value) {
          this.value = value;
        }
      }
      (0, import_vitest.expect)((0, import_strings.nicify)(new TestClass(42))).toBe('TestClass { "value": 42 }');
    });
  });
  (0, import_vitest.describe)("built-in objects", () => {
    (0, import_vitest.test)("URL", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(new URL("https://example.com"))).toBe('URL("https://example.com/")');
    });
    (0, import_vitest.test)("TypedArrays", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(new Uint8Array([1, 2, 3]))).toBe("Uint8Array([1,2,3])");
      (0, import_vitest.expect)((0, import_strings.nicify)(new Int32Array([1, 2, 3]))).toBe("Int32Array([1,2,3])");
    });
    (0, import_vitest.test)("Error objects", () => {
      const error = new Error("test error");
      const nicifiedError = (0, import_strings.nicify)({ error });
      (0, import_vitest.expect)(nicifiedError).toMatch(new RegExp(import_strings.deindent`
        ^\{
          "error": Error: test error
            Stack:
              at (.|\\n)*
        \}$
      `));
    });
    (0, import_vitest.test)("Error objects with cause and an extra property", () => {
      const error = new Error("test error", { cause: new Error("cause") });
      error.extra = "something";
      const nicifiedError = (0, import_strings.nicify)(error, { lineIndent: "--" });
      (0, import_vitest.expect)(nicifiedError).toMatch(new RegExp(import_strings.deindent`
        ^Error: test error
        --Stack:
        ----at (.|\\n)+
        --Extra properties: \{ "extra": "something" \}
        --Cause:
        ----Error: cause
        ------Stack:
        --------at (.|\\n)+$
      `));
    });
    (0, import_vitest.test)("Headers", () => {
      const headers = new Headers();
      headers.append("Content-Type", "application/json");
      headers.append("Accept", "text/plain");
      (0, import_vitest.expect)((0, import_strings.nicify)(headers)).toBe(
        import_strings.deindent`
        Headers {
          "accept": "text/plain",
          "content-type": "application/json",
        }`
      );
    });
  });
  (0, import_vitest.describe)("multiline strings", () => {
    (0, import_vitest.test)("basic multiline", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)("line1\nline2")).toBe("deindent`\n  line1\n  line2\n`");
    });
    (0, import_vitest.test)("multiline with trailing newline", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)("line1\nline2\n")).toBe('deindent`\n  line1\n  line2\n` + "\\n"');
    });
  });
  (0, import_vitest.describe)("circular references", () => {
    (0, import_vitest.test)("object with self reference", () => {
      const circular = { a: 1 };
      circular.self = circular;
      (0, import_vitest.expect)((0, import_strings.nicify)(circular)).toBe(
        import_strings.deindent`
        {
          "a": 1,
          "self": Ref<value>,
        }`
      );
    });
  });
  (0, import_vitest.describe)("configuration options", () => {
    (0, import_vitest.test)("maxDepth", () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      (0, import_vitest.expect)((0, import_strings.nicify)(deep, { maxDepth: 2 })).toBe('{ "a": { "b": { ... } } }');
    });
    (0, import_vitest.test)("lineIndent", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({ a: 1, b: 2 }, { lineIndent: "    " })).toBe(import_strings.deindent`
        {
            "a": 1,
            "b": 2,
        }
      `);
    });
    (0, import_vitest.test)("hideFields", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({ a: 1, b: 2, secret: "hidden" }, { hideFields: ["secret"] })).toBe(import_strings.deindent`
        {
          "a": 1,
          "b": 2,
          <some fields may have been hidden>,
        }
      `);
    });
  });
  (0, import_vitest.describe)("custom overrides", () => {
    (0, import_vitest.test)("override with custom type", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)({ type: "special" }, {
        overrides: (value) => {
          if (typeof value === "object" && value && "type" in value && value.type === "special") {
            return "SPECIAL";
          }
          return null;
        }
      })).toBe("SPECIAL");
    });
  });
  (0, import_vitest.describe)("functions", () => {
    (0, import_vitest.test)("named function", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(function namedFunction() {
      })).toBe("function namedFunction(...) { ... }");
    });
    (0, import_vitest.test)("arrow function", () => {
      (0, import_vitest.expect)((0, import_strings.nicify)(() => {
      })).toBe("(...) => { ... }");
    });
  });
  (0, import_vitest.describe)("Nicifiable interface", () => {
    (0, import_vitest.test)("object implementing Nicifiable", () => {
      const nicifiable = {
        value: 42,
        getNicifiableKeys() {
          return ["value"];
        },
        getNicifiedObjectExtraLines() {
          return ["// custom comment"];
        }
      };
      (0, import_vitest.expect)((0, import_strings.nicify)(nicifiable)).toBe(import_strings.deindent`
        {
          "value": 42,
          // custom comment,
        }
      `);
    });
  });
  (0, import_vitest.describe)("unknown types", () => {
    (0, import_vitest.test)("object without prototype", () => {
      const unknownType = /* @__PURE__ */ Object.create(null);
      unknownType.value = "test";
      (0, import_vitest.expect)((0, import_strings.nicify)(unknownType)).toBe('{ "value": "test" }');
    });
  });
});
//# sourceMappingURL=strings.nicify.test.js.map