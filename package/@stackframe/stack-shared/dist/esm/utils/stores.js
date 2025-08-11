// src/utils/stores.tsx
import { ReadWriteLock } from "./locks";
import { pending, rejected, resolved } from "./promises";
import { AsyncResult, Result } from "./results";
import { generateUuid } from "./uuids";
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
    const uuid = generateUuid();
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
var storeLock = new ReadWriteLock();
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
      return AsyncResult.error(this._rejectionError);
    } else if (this.isAvailable()) {
      return AsyncResult.ok(this._mostRecentOkValue);
    } else {
      return AsyncResult.pending();
    }
  }
  getOrWait() {
    const uuid = generateUuid();
    if (this.isRejected()) {
      return rejected(this._rejectionError);
    } else if (this.isAvailable()) {
      return resolved(this._mostRecentOkValue);
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
    return pending(withFinally);
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
    this._setIfLatest(Result.ok(value), ++this._updateCounter);
  }
  update(updater) {
    const value = updater(this._mostRecentOkValue);
    this.set(value);
    return value;
  }
  async setAsync(promise) {
    return await storeLock.withReadLock(async () => {
      const curCounter = ++this._updateCounter;
      const result = await Result.fromPromise(promise);
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
    this._setIfLatest(Result.error(error), ++this._updateCounter);
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
    const uuid = generateUuid();
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
export {
  AsyncStore,
  Store,
  storeLock
};
//# sourceMappingURL=stores.js.map