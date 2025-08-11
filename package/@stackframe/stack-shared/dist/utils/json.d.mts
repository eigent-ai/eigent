import { Result } from './results.mjs';

type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
type ReadonlyJson = null | boolean | number | string | readonly ReadonlyJson[] | {
    readonly [key: string]: ReadonlyJson;
};
declare function isJson(value: unknown): value is Json;
declare function parseJson(json: string): Result<Json>;
declare function stringifyJson(json: Json): Result<string>;

export { type Json, type ReadonlyJson, isJson, parseJson, stringifyJson };
