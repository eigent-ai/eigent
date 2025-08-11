declare function identity<T>(t: T): T;
declare function identityArgs<T extends any[]>(...args: T): T;

export { identity, identityArgs };
