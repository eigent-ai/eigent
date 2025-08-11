declare class WeakRefIfAvailable<T extends object> {
    private readonly _ref;
    constructor(value: T);
    deref(): T | undefined;
}
/**
 * A WeakMap-like object that can be iterated over.
 *
 * Note that it relies on WeakRef, and always falls back to the regular Map behavior (ie. no GC) in browsers that don't support it.
 */
declare class IterableWeakMap<K extends object, V> {
    private readonly _weakMap;
    private readonly _keyRefs;
    constructor(entries?: readonly (readonly [K, V])[] | null);
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    delete(key: K): boolean;
    has(key: K): boolean;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    [Symbol.toStringTag]: string;
}
/**
 * A map that is a IterableWeakMap for object keys and a regular Map for primitive keys. Also provides iteration over both
 * object and primitive keys.
 *
 * Note that, just like IterableWeakMap, older browsers without support for WeakRef will use a regular Map for object keys.
 */
declare class MaybeWeakMap<K, V> {
    private readonly _primitiveMap;
    private readonly _weakMap;
    constructor(entries?: readonly (readonly [K, V])[] | null);
    private _isAllowedInWeakMap;
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    delete(key: K): boolean;
    has(key: K): boolean;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    [Symbol.toStringTag]: string;
}
/**
 * A map that stores values indexed by an array of keys. If the keys are objects and the environment supports WeakRefs,
 * they are stored in a WeakMap.
 */
declare class DependenciesMap<K extends any[], V> {
    private _inner;
    private _valueToResult;
    private _unwrapFromInner;
    private _setInInner;
    private _iterateInner;
    get(dependencies: K): V | undefined;
    set(dependencies: K, value: V): this;
    delete(dependencies: K): boolean;
    has(dependencies: K): boolean;
    clear(): void;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    [Symbol.toStringTag]: string;
}

export { DependenciesMap, IterableWeakMap, MaybeWeakMap, WeakRefIfAvailable };
