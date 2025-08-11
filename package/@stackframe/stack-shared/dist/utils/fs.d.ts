declare function list(path: string): Promise<string[]>;
declare function listRecursively(p: string, options?: {
    excludeDirectories?: boolean;
}): Promise<string[]>;
declare function writeFileSyncIfChanged(path: string, content: string): void;

export { list, listRecursively, writeFileSyncIfChanged };
