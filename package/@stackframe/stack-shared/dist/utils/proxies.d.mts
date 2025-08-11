declare function logged<T extends object>(name: string, toLog: T, options?: {}): T;
declare function createLazyProxy<FactoryResult>(factory: () => FactoryResult): FactoryResult;

export { createLazyProxy, logged };
