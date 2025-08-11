/**
 * Like memo, but minimizes recomputation of the value at all costs (instead of useMemo which recomputes whenever the renderer feels like it).
 *
 * The most recent value will be kept from garbage collection until one of the dependencies becomes unreachable. This may be true even after the component no longer renders. Be wary of memory leaks.
 */
declare function useStrictMemo<T>(callback: () => T, dependencies: any[]): T;

export { useStrictMemo };
