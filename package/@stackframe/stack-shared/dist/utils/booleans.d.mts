type Truthy<T> = T extends null | undefined | 0 | "" | false ? false : true;
type Falsy<T> = T extends null | undefined | 0 | "" | false ? true : false;
declare function isTruthy<T>(value: T): value is T & Truthy<T>;
declare function isFalsy<T>(value: T): value is T & Falsy<T>;

export { type Falsy, type Truthy, isFalsy, isTruthy };
