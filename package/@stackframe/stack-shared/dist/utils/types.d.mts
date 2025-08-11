type IsAny<T> = 0 extends (1 & T) ? true : false;
type isNullish<T> = T extends null | undefined ? true : false;
type NullishCoalesce<T, U> = T extends null | undefined ? U : T;
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends ((x: infer I) => void) ? I : never;
/**
 * A variation of TypeScript's conditionals with slightly different semantics. It is the perfect type for cases where:
 *
 * - If all possible values are contained in `Extends`, then it will be mapped to `Then`.
 * - If all possible values are not contained in `Extends`, then it will be mapped to `Otherwise`.
 * - If some possible values are contained in `Extends` and some are not, then it will be mapped to `Then | Otherwise`.
 *
 * This is different from TypeScript's built-in conditional types (`Value extends Extends ? Then : Otherwise`), which
 * returns `Otherwise` for the third case (causing unsoundness in many real-world cases).
 */
type IfAndOnlyIf<Value, Extends, Then, Otherwise> = (Value extends Extends ? never : Otherwise) | (Value & Extends extends never ? never : Then);
/**
 * Can be used to prettify a type in the IDE; for example, some complicated intersected types can be flattened into a single type.
 */
type PrettifyType<T> = T extends object ? {
    [K in keyof T]: T[K];
} & {} : T;

export type { IfAndOnlyIf, IsAny, NullishCoalesce, PrettifyType, UnionToIntersection, isNullish };
