declare function typedToLowercase<S extends string>(s: S): Lowercase<S>;
declare function typedToUppercase<S extends string>(s: S): Uppercase<S>;
declare function typedCapitalize<S extends string>(s: S): Capitalize<S>;
/**
 * Compares two strings in a way that is not dependent on the current locale.
 */
declare function stringCompare(a: string, b: string): number;
/**
 * Returns all whitespace character at the start of the string.
 *
 * Uses the same definition for whitespace as `String.prototype.trim()`.
 */
declare function getWhitespacePrefix(s: string): string;
/**
 * Returns all whitespace character at the end of the string.
 *
 * Uses the same definition for whitespace as `String.prototype.trim()`.
 */
declare function getWhitespaceSuffix(s: string): string;
/**
 * Returns a string with all empty or whitespace-only lines at the start removed.
 *
 * Uses the same definition for whitespace as `String.prototype.trim()`.
 */
declare function trimEmptyLinesStart(s: string): string;
/**
 * Returns a string with all empty or whitespace-only lines at the end removed.
 *
 * Uses the same definition for whitespace as `String.prototype.trim()`.
 */
declare function trimEmptyLinesEnd(s: string): string;
/**
 * Returns a string with all empty or whitespace-only lines trimmed at the start and end.
 *
 * Uses the same definition for whitespace as `String.prototype.trim()`.
 */
declare function trimLines(s: string): string;
/**
 * A template literal tag that returns the same string as the template literal without a tag.
 *
 * Useful for implementing your own template literal tags.
 */
declare function templateIdentity(strings: TemplateStringsArray | readonly string[], ...values: string[]): string;
declare function deindent(code: string): string;
declare function deindent(strings: TemplateStringsArray | readonly string[], ...values: any[]): string;
declare function deindentTemplate(strings: TemplateStringsArray | readonly string[], ...values: any[]): [string[], ...string[]];
declare function extractScopes(scope: string, removeDuplicates?: boolean): string[];
declare function mergeScopeStrings(...scopes: string[]): string;
declare function escapeTemplateLiteral(s: string): string;
type Nicifiable = {
    getNicifiableKeys?(): PropertyKey[];
    getNicifiedObjectExtraLines?(): string[];
};
type NicifyOptions = {
    maxDepth: number;
    currentIndent: string;
    lineIndent: string;
    multiline: boolean;
    refs: Map<unknown, string>;
    path: string;
    parent: null | {
        options: NicifyOptions;
        value: unknown;
    };
    keyInParent: PropertyKey | null;
    hideFields: PropertyKey[];
    overrides: (...args: Parameters<typeof nicify>) => string | null;
};
declare function nicify(value: unknown, options?: Partial<NicifyOptions>): string;
declare function replaceAll(input: string, searchValue: string, replaceValue: string): string;

export { type Nicifiable, type NicifyOptions, deindent, deindentTemplate, escapeTemplateLiteral, extractScopes, getWhitespacePrefix, getWhitespaceSuffix, mergeScopeStrings, nicify, replaceAll, stringCompare, templateIdentity, trimEmptyLinesEnd, trimEmptyLinesStart, trimLines, typedCapitalize, typedToLowercase, typedToUppercase };
