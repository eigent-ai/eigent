type ConfigValue = string | number | boolean | null | ConfigValue[] | Config;
type Config = {
    [keyOrDotNotation: string]: ConfigValue | undefined;
};
type NormalizedConfigValue = string | number | boolean | NormalizedConfig | NormalizedConfigValue[];
type NormalizedConfig = {
    [key: string]: NormalizedConfigValue | undefined;
};
type _NormalizesTo<N> = N extends object ? (Config & {
    [K in keyof N]?: _NormalizesTo<N[K]> | null;
} & {
    [K in `${string}.${string}`]: ConfigValue;
}) : N;
type NormalizesTo<N extends NormalizedConfig> = _NormalizesTo<N>;
/**
 * Note that a config can both be valid and not normalizable.
 */
declare function isValidConfig(c: unknown): c is Config;
declare function getInvalidConfigReason(c: unknown, options?: {
    configName?: string;
}): string | undefined;
declare function assertValidConfig(c: unknown): void;
declare function override(c1: Config, ...configs: Config[]): Config;
type NormalizeOptions = {
    /**
     * What to do if a dot notation is used on null.
     *
     * - "empty" (default): Replace the null with an empty object.
     * - "throw": Throw an error.
     * - "ignore": Ignore the dot notation field.
     */
    onDotIntoNull?: "empty" | "throw" | "ignore";
};
declare class NormalizationError extends Error {
    constructor(...args: ConstructorParameters<typeof Error>);
}
declare function normalize(c: Config, options?: NormalizeOptions): NormalizedConfig;

export { type Config, type ConfigValue, NormalizationError, type NormalizedConfig, type NormalizedConfigValue, type NormalizesTo, type _NormalizesTo, assertValidConfig, getInvalidConfigReason, isValidConfig, normalize, override };
