declare const globalVar: any;

declare function createGlobal<T>(key: string, init: () => T): T;

export { createGlobal, globalVar };
