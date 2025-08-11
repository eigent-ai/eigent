// src/utils/maps.tsx
import { Result } from "./results";
var WeakRefIfAvailable = class {
  constructor(value) {
    if (typeof WeakRef === "undefined") {
      this._ref = { deref: () => value };
    } else {
      this._ref = new WeakRef(value);
    }
  }
  deref() {
    return this._ref.deref();
  }
};
var _a, _b;
var IterableWeakMap = class {
  constructor(entries) {
    this[_a] = "IterableWeakMap";
    const mappedEntries = entries?.map((e) => [e[0], { value: e[1], keyRef: new WeakRefIfAvailable(e[0]) }]);
    this._weakMap = new WeakMap(mappedEntries ?? []);
    this._keyRefs = new Set(mappedEntries?.map((e) => e[1].keyRef) ?? []);
  }
  get(key) {
    return this._weakMap.get(key)?.value;
  }
  set(key, value) {
    const existing = this._weakMap.get(key);
    const updated = { value, keyRef: existing?.keyRef ?? new WeakRefIfAvailable(key) };
    this._weakMap.set(key, updated);
    this._keyRefs.add(updated.keyRef);
    return this;
  }
  delete(key) {
    const res = this._weakMap.get(key);
    if (res) {
      this._weakMap.delete(key);
      this._keyRefs.delete(res.keyRef);
      return true;
    }
    return false;
  }
  has(key) {
    return this._weakMap.has(key) && this._keyRefs.has(this._weakMap.get(key).keyRef);
  }
  *[(_b = Symbol.iterator, _a = Symbol.toStringTag, _b)]() {
    for (const keyRef of this._keyRefs) {
      const key = keyRef.deref();
      const existing = key ? this._weakMap.get(key) : void 0;
      if (!key) {
        this._keyRefs.delete(keyRef);
      } else if (existing) {
        yield [key, existing.value];
      }
    }
  }
};
var _a2, _b2;
var MaybeWeakMap = class {
  constructor(entries) {
    this[_a2] = "MaybeWeakMap";
    const entriesArray = [...entries ?? []];
    this._primitiveMap = new Map(entriesArray.filter((e) => !this._isAllowedInWeakMap(e[0])));
    this._weakMap = new IterableWeakMap(entriesArray.filter((e) => this._isAllowedInWeakMap(e[0])));
  }
  _isAllowedInWeakMap(key) {
    return typeof key === "object" && key !== null || typeof key === "symbol" && Symbol.keyFor(key) === void 0;
  }
  get(key) {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.get(key);
    } else {
      return this._primitiveMap.get(key);
    }
  }
  set(key, value) {
    if (this._isAllowedInWeakMap(key)) {
      this._weakMap.set(key, value);
    } else {
      this._primitiveMap.set(key, value);
    }
    return this;
  }
  delete(key) {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.delete(key);
    } else {
      return this._primitiveMap.delete(key);
    }
  }
  has(key) {
    if (this._isAllowedInWeakMap(key)) {
      return this._weakMap.has(key);
    } else {
      return this._primitiveMap.has(key);
    }
  }
  *[(_b2 = Symbol.iterator, _a2 = Symbol.toStringTag, _b2)]() {
    yield* this._primitiveMap;
    yield* this._weakMap;
  }
};
var _a3, _b3;
var DependenciesMap = class {
  constructor() {
    this._inner = { map: new MaybeWeakMap(), hasValue: false, value: void 0 };
    this[_a3] = "DependenciesMap";
  }
  _valueToResult(inner) {
    if (inner.hasValue) {
      return Result.ok(inner.value);
    } else {
      return Result.error(void 0);
    }
  }
  _unwrapFromInner(dependencies, inner) {
    if (dependencies.length === 0) {
      return this._valueToResult(inner);
    } else {
      const [key, ...rest] = dependencies;
      const newInner = inner.map.get(key);
      if (!newInner) {
        return Result.error(void 0);
      }
      return this._unwrapFromInner(rest, newInner);
    }
  }
  _setInInner(dependencies, value, inner) {
    if (dependencies.length === 0) {
      const res = this._valueToResult(inner);
      if (value.status === "ok") {
        inner.hasValue = true;
        inner.value = value.data;
      } else {
        inner.hasValue = false;
        inner.value = void 0;
      }
      return res;
    } else {
      const [key, ...rest] = dependencies;
      let newInner = inner.map.get(key);
      if (!newInner) {
        inner.map.set(key, newInner = { map: new MaybeWeakMap(), hasValue: false, value: void 0 });
      }
      return this._setInInner(rest, value, newInner);
    }
  }
  *_iterateInner(dependencies, inner) {
    if (inner.hasValue) {
      yield [dependencies, inner.value];
    }
    for (const [key, value] of inner.map) {
      yield* this._iterateInner([...dependencies, key], value);
    }
  }
  get(dependencies) {
    return Result.or(this._unwrapFromInner(dependencies, this._inner), void 0);
  }
  set(dependencies, value) {
    this._setInInner(dependencies, Result.ok(value), this._inner);
    return this;
  }
  delete(dependencies) {
    return this._setInInner(dependencies, Result.error(void 0), this._inner).status === "ok";
  }
  has(dependencies) {
    return this._unwrapFromInner(dependencies, this._inner).status === "ok";
  }
  clear() {
    this._inner = { map: new MaybeWeakMap(), hasValue: false, value: void 0 };
  }
  *[(_b3 = Symbol.iterator, _a3 = Symbol.toStringTag, _b3)]() {
    yield* this._iterateInner([], this._inner);
  }
};
export {
  DependenciesMap,
  IterableWeakMap,
  MaybeWeakMap,
  WeakRefIfAvailable
};
//# sourceMappingURL=maps.js.map