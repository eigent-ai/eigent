type LockCallback<T> = () => Promise<T>;
declare class ReadWriteLock {
    private semaphore;
    private readers;
    private readersMutex;
    constructor();
    withReadLock<T>(callback: LockCallback<T>): Promise<T>;
    withWriteLock<T>(callback: LockCallback<T>): Promise<T>;
    private _acquireReadLock;
    private _releaseReadLock;
    private _acquireWriteLock;
    private _releaseWriteLock;
}

export { ReadWriteLock };
