// src/utils/strings.nicify.test.ts
import { describe, expect, test } from "vitest";
import { deindent, nicify } from "./strings";
describe("nicify", () => {
  describe("primitive values", () => {
    test("numbers", () => {
      expect(nicify(123)).toBe("123");
      expect(nicify(123n)).toBe("123n");
    });
    test("strings", () => {
      expect(nicify("hello")).toBe('"hello"');
    });
    test("booleans", () => {
      expect(nicify(true)).toBe("true");
      expect(nicify(false)).toBe("false");
    });
    test("null and undefined", () => {
      expect(nicify(null)).toBe("null");
      expect(nicify(void 0)).toBe("undefined");
    });
    test("symbols", () => {
      expect(nicify(Symbol("test"))).toBe("Symbol(test)");
    });
  });
  describe("arrays", () => {
    test("empty array", () => {
      expect(nicify([])).toBe("[]");
    });
    test("single-element array", () => {
      expect(nicify([1])).toBe("[1]");
    });
    test("single-element array with long content", () => {
      expect(nicify(["123123123123123"])).toBe('["123123123123123"]');
    });
    test("flat array", () => {
      expect(nicify([1, 2, 3])).toBe("[1, 2, 3]");
    });
    test("longer array", () => {
      expect(nicify([1e4, 2, 3])).toBe(deindent`
        [
          10000,
          2,
          3,
        ]
      `);
    });
    test("nested array", () => {
      expect(nicify([1, [2, 3]])).toBe(deindent`
        [
          1,
          [2, 3],
        ]
      `);
    });
  });
  describe("objects", () => {
    test("empty object", () => {
      expect(nicify({})).toBe("{}");
    });
    test("simple object", () => {
      expect(nicify({ a: 1 })).toBe('{ "a": 1 }');
    });
    test("multiline object", () => {
      expect(nicify({ a: 1, b: 2 })).toBe(deindent`
        {
          "a": 1,
          "b": 2,
        }
      `);
    });
  });
  describe("custom classes", () => {
    test("class instance", () => {
      class TestClass {
        constructor(value) {
          this.value = value;
        }
      }
      expect(nicify(new TestClass(42))).toBe('TestClass { "value": 42 }');
    });
  });
  describe("built-in objects", () => {
    test("URL", () => {
      expect(nicify(new URL("https://example.com"))).toBe('URL("https://example.com/")');
    });
    test("TypedArrays", () => {
      expect(nicify(new Uint8Array([1, 2, 3]))).toBe("Uint8Array([1,2,3])");
      expect(nicify(new Int32Array([1, 2, 3]))).toBe("Int32Array([1,2,3])");
    });
    test("Error objects", () => {
      const error = new Error("test error");
      const nicifiedError = nicify({ error });
      expect(nicifiedError).toMatch(new RegExp(deindent`
        ^\{
          "error": Error: test error
            Stack:
              at (.|\\n)*
        \}$
      `));
    });
    test("Error objects with cause and an extra property", () => {
      const error = new Error("test error", { cause: new Error("cause") });
      error.extra = "something";
      const nicifiedError = nicify(error, { lineIndent: "--" });
      expect(nicifiedError).toMatch(new RegExp(deindent`
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
    test("Headers", () => {
      const headers = new Headers();
      headers.append("Content-Type", "application/json");
      headers.append("Accept", "text/plain");
      expect(nicify(headers)).toBe(
        deindent`
        Headers {
          "accept": "text/plain",
          "content-type": "application/json",
        }`
      );
    });
  });
  describe("multiline strings", () => {
    test("basic multiline", () => {
      expect(nicify("line1\nline2")).toBe("deindent`\n  line1\n  line2\n`");
    });
    test("multiline with trailing newline", () => {
      expect(nicify("line1\nline2\n")).toBe('deindent`\n  line1\n  line2\n` + "\\n"');
    });
  });
  describe("circular references", () => {
    test("object with self reference", () => {
      const circular = { a: 1 };
      circular.self = circular;
      expect(nicify(circular)).toBe(
        deindent`
        {
          "a": 1,
          "self": Ref<value>,
        }`
      );
    });
  });
  describe("configuration options", () => {
    test("maxDepth", () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      expect(nicify(deep, { maxDepth: 2 })).toBe('{ "a": { "b": { ... } } }');
    });
    test("lineIndent", () => {
      expect(nicify({ a: 1, b: 2 }, { lineIndent: "    " })).toBe(deindent`
        {
            "a": 1,
            "b": 2,
        }
      `);
    });
    test("hideFields", () => {
      expect(nicify({ a: 1, b: 2, secret: "hidden" }, { hideFields: ["secret"] })).toBe(deindent`
        {
          "a": 1,
          "b": 2,
          <some fields may have been hidden>,
        }
      `);
    });
  });
  describe("custom overrides", () => {
    test("override with custom type", () => {
      expect(nicify({ type: "special" }, {
        overrides: (value) => {
          if (typeof value === "object" && value && "type" in value && value.type === "special") {
            return "SPECIAL";
          }
          return null;
        }
      })).toBe("SPECIAL");
    });
  });
  describe("functions", () => {
    test("named function", () => {
      expect(nicify(function namedFunction() {
      })).toBe("function namedFunction(...) { ... }");
    });
    test("arrow function", () => {
      expect(nicify(() => {
      })).toBe("(...) => { ... }");
    });
  });
  describe("Nicifiable interface", () => {
    test("object implementing Nicifiable", () => {
      const nicifiable = {
        value: 42,
        getNicifiableKeys() {
          return ["value"];
        },
        getNicifiedObjectExtraLines() {
          return ["// custom comment"];
        }
      };
      expect(nicify(nicifiable)).toBe(deindent`
        {
          "value": 42,
          // custom comment,
        }
      `);
    });
  });
  describe("unknown types", () => {
    test("object without prototype", () => {
      const unknownType = /* @__PURE__ */ Object.create(null);
      unknownType.value = "test";
      expect(nicify(unknownType)).toBe('{ "value": "test" }');
    });
  });
});
//# sourceMappingURL=strings.nicify.test.js.map