"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/stores.tsx
var stores_exports = {};
__export(stores_exports, {
  AsyncStore: () => AsyncStore,
  Store: () => Store,
  storeLock: () => storeLock
});
module.exports = __toCommonJS(stores_exports);
var import_locks = require("./locks");
var import_promises = require("./promises");
var import_results = require("./results");
var import_uuids = require("./uuids");
var Store = class {
  constructor(_value) {
    this._value = _value;
    this._callbacks = /* @__PURE__ */ new Map();
  }
  get() {
    return this._value;
  }
  set(value) {
    const oldValue = this._value;
    this._value = value;
    this._callbacks.forEach((callback) => callback(value, oldValue));
  }
  update(updater) {
    const value = updater(this._value);
    this.set(value);
    return value;
  }
  onChange(callback) {
    const uuid = (0, import_uuids.generateUuid)();
    this._callbacks.set(uuid, callback);
    return {
      unsubscribe: () => {
        this._callbacks.delete(uuid);
      }
    };
  }
  onceChange(callback) {
    const { unsubscribe } = this.onChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }
};
var storeLock = new import_locks.ReadWriteLock();
var AsyncStore = class _AsyncStore {
  constructor(...args) {
    this._mostRecentOkValue = void 0;
    this._isRejected = false;
    this._waitingRejectFunctions = /* @__PURE__ */ new Map();
    this._callbacks = /* @__PURE__ */ new Map();
    this._updateCounter = 0;
    this._lastSuccessfulUpdate = -1;
    if (args.length === 0) {
      this._isAvailable = false;
    } else {
      this._isAvailable = true;
      this._mostRecentOkValue = args[0];
    }
  }
  isAvailable() {
    return this._isAvailable;
  }
  isRejected() {
    return this._isRejected;
  }
  get() {
    if (this.isRejected()) {
      return import_results.AsyncResult.error(this._rejectionError);
    } else if (this.isAvailable()) {
      return import_results.AsyncResult.ok(this._mostRecentOkValue);
    } else {
      return import_results.AsyncResult.pending();
    }
  }
  getOrWait() {
    const uuid = (0, import_uuids.generateUuid)();
    if (this.isRejected()) {
      return (0, import_promises.rejected)(this._rejectionError);
    } else if (this.isAvailable()) {
      return (0, import_promises.resolved)(this._mostRecentOkValue);
    }
    const promise = new Promise((resolve, reject) => {
      this.onceChange((value) => {
        resolve(value);
      });
      this._waitingRejectFunctions.set(uuid, reject);
    });
    const withFinally = promise.finally(() => {
      this._waitingRejectFunctions.delete(uuid);
    });
    return (0, import_promises.pending)(withFinally);
  }
  _setIfLatest(result, curCounter) {
    const oldState = this.get();
    const oldValue = this._mostRecentOkValue;
    if (curCounter > this._lastSuccessfulUpdate) {
      switch (result.status) {
        case "ok": {
          if (!this._isAvailable || this._isRejected || this._mostRecentOkValue !== result.data) {
            this._lastSuccessfulUpdate = curCounter;
            this._isAvailable = true;
            this._isRejected = false;
            this._mostRecentOkValue = result.data;
            this._rejectionError = void 0;
            this._callbacks.forEach((callback) => callback({
              state: this.get(),
              oldState,
              lastOkValue: oldValue
            }));
            return true;
          }
          return false;
        }
        case "error": {
          this._lastSuccessfulUpdate = curCounter;
          this._isAvailable = false;
          this._isRejected = true;
          this._rejectionError = result.error;
          this._waitingRejectFunctions.forEach((reject) => reject(result.error));
          this._callbacks.forEach((callback) => callback({
            state: this.get(),
            oldState,
            lastOkValue: oldValue
          }));
          return true;
        }
      }
    }
    return false;
  }
  set(value) {
    this._setIfLatest(import_results.Result.ok(value), ++this._updateCounter);
  }
  update(updater) {
    const value = updater(this._mostRecentOkValue);
    this.set(value);
    return value;
  }
  async setAsync(promise) {
    return await storeLock.withReadLock(async () => {
      const curCounter = ++this._updateCounter;
      const result = await import_results.Result.fromPromise(promise);
      return this._setIfLatest(result, curCounter);
    });
  }
  setUnavailable() {
    this._lastSuccessfulUpdate = ++this._updateCounter;
    this._isAvailable = false;
    this._isRejected = false;
    this._rejectionError = void 0;
  }
  setRejected(error) {
    this._setIfLatest(import_results.Result.error(error), ++this._updateCounter);
  }
  map(mapper) {
    const store = new _AsyncStore();
    this.onChange((value) => {
      store.set(mapper(value));
    });
    return store;
  }
  onChange(callback) {
    return this.onStateChange(({ state, lastOkValue }) => {
      if (state.status === "ok") {
        callback(state.data, lastOkValue);
      }
    });
  }
  onStateChange(callback) {
    const uuid = (0, import_uuids.generateUuid)();
    this._callbacks.set(uuid, callback);
    return {
      unsubscribe: () => {
        this._callbacks.delete(uuid);
      }
    };
  }
  onceChange(callback) {
    const { unsubscribe } = this.onChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }
  onceStateChange(callback) {
    const { unsubscribe } = this.onStateChange((...args) => {
      unsubscribe();
      callback(...args);
    });
    return { unsubscribe };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AsyncStore,
  Store,
  storeLock
});
//# sourceMappingURL=stores.js.map