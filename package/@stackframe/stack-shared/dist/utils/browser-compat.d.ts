declare function getBrowserCompatibilityReport(): {
    optionalChaining: string | boolean;
    nullishCoalescing: string | boolean;
    weakRef: string | boolean;
    cryptoUuid: string | boolean;
};

export { getBrowserCompatibilityReport };
