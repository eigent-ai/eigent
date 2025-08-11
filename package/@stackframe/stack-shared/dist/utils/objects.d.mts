declare function isNotNull<T>(value: T): value is NonNullable<T>;
type DeepPartial<T> = T extends object ? (T extends (infer E)[] ? T : {
    [P in keyof T]?: DeepPartial<T[P]>;
}) : T;
type DeepRequired<T> = T extends object ? (T extends (infer E)[] ? T : {
    [P in keyof T]-?: DeepRequired<T[P]>;
}) : T;
/**
 * Assumes both objects are primitives, arrays, or non-function plain objects, and compares them deeply.
 *
 * Note that since they are assumed to be plain objects, this function does not compare prototypes.
 */
declare function deepPlainEquals<T>(obj1: T, obj2: unknown, options?: {
    ignoreUndefinedValues?: boolean;
}): obj2 is T;
declare function isCloneable<T>(obj: T): obj is Exclude<T, symbol | Function>;
declare function shallowClone<T extends object>(obj: T): T;
declare function deepPlainClone<T>(obj: T): T;
type DeepMerge<T, U> = Omit<T, keyof U> & Omit<U, keyof T> & DeepMergeInner<Pick<T, keyof U & keyof T>, Pick<U, keyof U & keyof T>>;
type DeepMergeInner<T, U> = {
    [K in keyof U]-?: undefined extends U[K] ? K extends keyof T ? T[K] extends object ? Exclude<U[K], undefined> extends object ? DeepMerge<T[K], Exclude<U[K], undefined>> : T[K] | Exclude<U[K], undefined> : T[K] | Exclude<U[K], undefined> : Exclude<U[K], undefined> : K extends keyof T ? T[K] extends object ? U[K] extends object ? DeepMerge<T[K], U[K]> : U[K] : U[K] : U[K];
};
declare function deepMerge<T extends {}, U extends {}>(baseObj: T, mergeObj: U): DeepMerge<T, U>;
declare function typedEntries<T extends {}>(obj: T): [keyof T, T[keyof T]][];
declare function typedFromEntries<K extends PropertyKey, V>(entries: (readonly [K, V])[]): Record<K, V>;
declare function typedKeys<T extends {}>(obj: T): (keyof T)[];
declare function typedValues<T extends {}>(obj: T): T[keyof T][];
declare function typedAssign<T extends {}, U extends {}>(target: T, source: U): T & U;
type FilterUndefined<T> = {
    [k in keyof T as (undefined extends T[k] ? (T[k] extends undefined | void ? never : k) : never)]+?: T[k] & ({} | null);
} & {
    [k in keyof T as (undefined extends T[k] ? never : k)]: T[k] & ({} | null);
};
/**
 * Returns a new object with all undefined values removed. Useful when spreading optional parameters on an object, as
 * TypeScript's `Partial<XYZ>` type allows `undefined` values.
 */
declare function filterUndefined<T extends object>(obj: T): FilterUndefined<T>;
type FilterUndefinedOrNull<T> = FilterUndefined<{
    [k in keyof T]: null extends T[k] ? NonNullable<T[k]> | undefined : T[k];
}>;
/**
 * Returns a new object with all undefined and null values removed. Useful when spreading optional parameters on an object, as
 * TypeScript's `Partial<XYZ>` type allows `undefined` values.
 */
declare function filterUndefinedOrNull<T extends object>(obj: T): FilterUndefinedOrNull<T>;
type DeepFilterUndefined<T> = T extends object ? FilterUndefined<{
    [K in keyof T]: DeepFilterUndefined<T[K]>;
}> : T;
declare function deepFilterUndefined<T extends object>(obj: T): DeepFilterUndefined<T>;
declare function pick<T extends {}, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
declare function omit<T extends {}, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
declare function split<T extends {}, K extends keyof T>(obj: T, keys: K[]): [Pick<T, K>, Omit<T, K>];
declare function mapValues<T extends object, U>(obj: T, fn: (value: T extends (infer E)[] ? E : T[keyof T]) => U): Record<keyof T, U>;
declare function sortKeys<T extends object>(obj: T): T;
declare function deepSortKeys<T extends object>(obj: T): T;
declare function set<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void;
declare function get<T extends object, K extends keyof T>(obj: T, key: K): T[K];
declare function getOrUndefined<T extends object, K extends keyof T>(obj: T, key: K): T[K] | undefined;
declare function has<T extends object, K extends keyof T>(obj: T, key: K): obj is T & {
    [k in K]: unknown;
};
declare function hasAndNotUndefined<T extends object, K extends keyof T>(obj: T, key: K): obj is T & {
    [k in K]: Exclude<T[K], undefined>;
};
declare function deleteKey<T extends object, K extends keyof T>(obj: T, key: K): void;
declare function isObjectLike(value: unknown): value is object;

export { type DeepFilterUndefined, type DeepMerge, type DeepPartial, type DeepRequired, type FilterUndefined, type FilterUndefinedOrNull, deepFilterUndefined, deepMerge, deepPlainClone, deepPlainEquals, deepSortKeys, deleteKey, filterUndefined, filterUndefinedOrNull, get, getOrUndefined, has, hasAndNotUndefined, isCloneable, isNotNull, isObjectLike, mapValues, omit, pick, set, shallowClone, sortKeys, split, typedAssign, typedEntries, typedFromEntries, typedKeys, typedValues };
