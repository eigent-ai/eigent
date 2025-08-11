declare function typedIncludes<T extends readonly any[]>(arr: T, item: unknown): item is T[number];
declare function enumerate<T extends readonly any[]>(arr: T): [number, T[number]][];
declare function isShallowEqual(a: readonly any[], b: readonly any[]): boolean;
/**
 * Ponyfill for ES2023's findLastIndex.
 */
declare function findLastIndex<T>(arr: readonly T[], predicate: (item: T) => boolean): number;
declare function groupBy<T extends any, K>(arr: Iterable<T>, key: (item: T) => K): Map<K, T[]>;
declare function range(endExclusive: number): number[];
declare function range(startInclusive: number, endExclusive: number): number[];
declare function range(startInclusive: number, endExclusive: number, step: number): number[];
declare function rotateLeft(arr: readonly any[], n: number): any[];
declare function rotateRight(arr: readonly any[], n: number): any[];
declare function shuffle<T>(arr: readonly T[]): T[];
declare function outerProduct<T, U>(arr1: readonly T[], arr2: readonly U[]): [T, U][];
declare function unique<T>(arr: readonly T[]): T[];

export { enumerate, findLastIndex, groupBy, isShallowEqual, outerProduct, range, rotateLeft, rotateRight, shuffle, typedIncludes, unique };
