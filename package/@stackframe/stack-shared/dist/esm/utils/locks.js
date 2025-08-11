// src/utils/locks.tsx
import { Semaphore } from "async-mutex";
var ReadWriteLock = class {
  constructor() {
    this.semaphore = new Semaphore(1);
    this.readers = 0;
    this.readersMutex = new Semaphore(1);
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
export {
  ReadWriteLock
};
//# sourceMappingURL=locks.js.map