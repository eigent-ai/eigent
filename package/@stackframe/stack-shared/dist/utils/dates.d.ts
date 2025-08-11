declare function isWeekend(date: Date): boolean;
declare function fromNow(date: Date): string;
declare function fromNowDetailed(date: Date): {
    result: string;
    /**
     * May be Infinity if the result will never change.
     */
    secondsUntilChange: number;
};
/**
 * Returns a string representation of the given date in the format expected by the `datetime-local` input type.
 */
declare function getInputDatetimeLocalString(date: Date): string;

export { fromNow, fromNowDetailed, getInputDatetimeLocalString, isWeekend };
