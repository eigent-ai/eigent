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

// src/utils/locks.tsx
var locks_exports = {};
__export(locks_exports, {
  ReadWriteLock: () => ReadWriteLock
});
module.exports = __toCommonJS(locks_exports);
var import_async_mutex = require("async-mutex");
var ReadWriteLock = class {
  constructor() {
    this.semaphore = new import_async_mutex.Semaphore(1);
    this.readers = 0;
    this.readersMutex = new import_async_mutex.Semaphore(1);
  }
  async withReadLock(callback) {
    await this._acquireReadLock();
    try {
      return await callback();
    } finally {
      await this._releaseReadLock();
    }
  }
  async withWriteLock(callback) {
    await this._acquireWriteLock();
    try {
      return await callback();
    } finally {
      await this._releaseWriteLock();
    }
  }
  async _acquireReadLock() {
    await this.readersMutex.acquire();
    try {
      this.readers += 1;
      if (this.readers === 1) {
        await this.semaphore.acquire();
      }
    } finally {
      this.readersMutex.release();
    }
  }
  async _releaseReadLock() {
    await this.readersMutex.acquire();
    try {
      this.readers -= 1;
      if (this.readers === 0) {
        this.semaphore.release();
      }
    } finally {
      this.readersMutex.release();
    }
  }
  async _acquireWriteLock() {
    await this.semaphore.acquire();
  }
  async _releaseWriteLock() {
    this.semaphore.release();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ReadWriteLock
});
//# sourceMappingURL=locks.js.map