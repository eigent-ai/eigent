import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { InputSelect, type InputSelectOption } from "@/components/ui/input-select";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { format, parse } from "date-fns";

type FrequencyType = "one-time" | "daily" | "weekly" | "monthly";

type SchedulePickerProps = {
    value: string; // cron expression
    onChange: (cronExpression: string) => void;
    onValidationChange?: (isValid: boolean) => void;
    showErrors?: boolean;
};

// Generate hour options (0-23)
const generateHourOptions = (): InputSelectOption[] => {
    return Array.from({ length: 24 }, (_, i) => {
        const value = i.toString().padStart(2, "0");
        return {
            value: value,
            label: value,
        };
    });
};

// Generate minute options (0-59)
const generateMinuteOptions = (): InputSelectOption[] => {
    return Array.from({ length: 60 }, (_, i) => {
        const value = i.toString().padStart(2, "0");
        return {
            value: value,
            label: value,
        };
    });
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
    value,
    onChange,
    onValidationChange,
    showErrors = false,
}) => {
    const { t } = useTranslation();
    const [frequency, setFrequency] = useState<FrequencyType>("daily");
    const [hour, setHour] = useState<string>("00");
    const [minute, setMinute] = useState<string>("00");
    const [weekdays, setWeekdays] = useState<string[]>(["1"]); // Array of weekday strings: ["0", "1", ...]
    const [dayOfMonth, setDayOfMonth] = useState<string>("1"); // 1-31
    const [oneTimeDate, setOneTimeDate] = useState<Date | undefined>(undefined);
    const [expiredAt, setExpiredAt] = useState<Date | undefined>(undefined);
    const [cronError, setCronError] = useState<string | null>(null);

    const hourOptions = useMemo(() => generateHourOptions(), []);
    const minuteOptions = useMemo(() => generateMinuteOptions(), []);
    const previousCronRef = useRef<string>("");

    // Memoize disabled function for date pickers to prevent re-renders
    const disabledPastDates = useCallback((date: Date) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date < today;
    }, []);

    // Parse cron field (minute, hour, day, month, weekday)
    const parseCronField = useCallback((field: string, min: number, max: number): number[] => {
        if (field === "*") {
            return Array.from({ length: max - min + 1 }, (_, i) => i + min);
        }

        const values: number[] = [];
        const parts = field.split(",");

        for (const part of parts) {
            if (part.includes("/")) {
                // Step values: */5, 0-59/15
                const [range, step] = part.split("/");
                const stepNum = Math.max(1, parseInt(step) || 1);

                if (range === "*") {
                    for (let i = min; i <= max; i += stepNum) {
                        values.push(i);
                    }
                } else if (range.includes("-")) {
                    const [start, end] = range.split("-").map(Number);
                    if (!isNaN(start) && !isNaN(end)) {
                        for (let i = start; i <= end; i += stepNum) {
                            values.push(i);
                        }
                    }
                } else {
                    const start = parseInt(range);
                    if (!isNaN(start)) {
                        for (let i = start; i <= max; i += stepNum) {
                            values.push(i);
                        }
                    }
                }
            } else if (part.includes("-")) {
                // Range: 1-5
                const [start, end] = part.split("-").map(Number);
                for (let i = start; i <= end; i++) {
                    values.push(i);
                }
            } else {
                // Single value
                values.push(parseInt(part));
            }
        }

        return [...new Set(values)].sort((a, b) => a - b);
    }, []);

    // Validate cron expression format
    const validateCronExpression = useCallback((cronExpression: string): string | null => {
        if (!cronExpression || cronExpression.trim() === "") {
            return t("triggers.cron-empty");
        }

        const parts = cronExpression.trim().split(/\s+/);
        if (parts.length !== 5) {
            return t("triggers.cron-invalid-format");
        }

        const [minuteField, hourField, dayField, monthField, weekdayField] = parts;

        try {
            // Validate minute (0-59)
            const minutes = parseCronField(minuteField, 0, 59);
            if (minutes.length === 0 || minutes.some(m => m < 0 || m > 59)) {
                return t("triggers.cron-invalid-minute");
            }

            // Validate hour (0-23)
            const hours = parseCronField(hourField, 0, 23);
            if (hours.length === 0 || hours.some(h => h < 0 || h > 23)) {
                return t("triggers.cron-invalid-hour");
            }

            // Validate day of month (1-31)
            const days = parseCronField(dayField, 1, 31);
            if (days.length === 0 || days.some(d => d < 1 || d > 31)) {
                return t("triggers.cron-invalid-day");
            }

            // Validate month (1-12)
            const months = parseCronField(monthField, 1, 12);
            if (months.length === 0 || months.some(m => m < 1 || m > 12)) {
                return t("triggers.cron-invalid-month");
            }

            // Validate weekday (0-6)
            const weekdays = parseCronField(weekdayField, 0, 6);
            if (weekdays.length === 0 || weekdays.some(w => w < 0 || w > 6)) {
                return t("triggers.cron-invalid-weekday");
            }

            return null; // Valid
        } catch (error) {
            return t("triggers.cron-invalid-format");
        }
    }, [t, parseCronField]);

    // Helper function to normalize cron field values for InputSelect compatibility
    // Converts patterns like "*/1" to simple values like "0"
    const normalizeCronField = useCallback((field: string, defaultValue: string = "0", pad: boolean = false): string => {
        // If it's a simple number, return it (optionally padded)
        if (/^\d+$/.test(field)) {
            return pad ? field.padStart(2, "0") : field;
        }
        // For patterns like "*/1", "*", or any other complex pattern, return default
        return pad ? defaultValue.padStart(2, "0") : defaultValue;
    }, []);

    // Parse initial cron expression (only when value prop changes externally)
    useEffect(() => {
        // Skip if this is the cron we just generated (prevent infinite loop)
        if (value && value !== previousCronRef.current) {
            const parts = value.split(" ");
            if (parts.length === 5) {
                const [min, hr, day, month, weekdayPart] = parts;

                // Normalize minute and hour to simple values for InputSelect
                const normalizedMin = normalizeCronField(min, "0", true);
                const normalizedHr = normalizeCronField(hr, "0", true);

                // One-time: specific date and time (e.g., "30 14 15 1 *" = Jan 15 at 2:30 PM)
                if (month !== "*" && day !== "*" && weekdayPart === "*") {
                    setFrequency("one-time");
                    setMinute(normalizedMin);
                    setHour(normalizedHr);
                    // Create date from month and day (assuming current year)
                    const currentYear = new Date().getFullYear();
                    const date = new Date(currentYear, parseInt(month) - 1, parseInt(day));
                    setOneTimeDate(date);
                    setCronError(null);
                }
                // Weekly: minute hour * * weekday (can be comma-separated)
                else if (day === "*" && month === "*" && weekdayPart !== "*") {
                    setFrequency("weekly");
                    setMinute(normalizedMin);
                    setHour(normalizedHr);
                    // Parse weekday - can be single value or comma-separated
                    const weekdayValues = weekdayPart.split(",").map(w => w.trim());
                    setWeekdays(weekdayValues.length > 0 ? weekdayValues : ["0"]);
                    setCronError(null);
                }
                // Monthly: minute hour day * *
                else if (day !== "*" && month === "*" && weekdayPart === "*") {
                    setFrequency("monthly");
                    setMinute(normalizedMin);
                    setHour(normalizedHr);
                    setDayOfMonth(normalizeCronField(day, "1"));
                    setCronError(null);
                }
                // Daily: minute hour * * * (also handles */1 patterns as "every hour")
                else if (day === "*" && month === "*" && weekdayPart === "*") {
                    setFrequency("daily");
                    setMinute(normalizedMin);
                    setHour(normalizedHr);
                    setCronError(null);
                } else {
                    // Default to daily if can't parse
                    setFrequency("daily");
                    setMinute("0");
                    setHour("0");
                    setCronError(null);
                }
                // Update the ref to track this value so we don't re-parse it
                previousCronRef.current = value;
            }
        }
    }, [value, normalizeCronField]);

    // Generate cron expression based on frequency - only when local state changes
    useEffect(() => {
        // Generate cron from current local state
        let cron = "";
        switch (frequency) {
            case "one-time":
                if (oneTimeDate) {
                    const month = oneTimeDate.getMonth() + 1; // getMonth() returns 0-11
                    const day = oneTimeDate.getDate();
                    cron = `${minute} ${hour} ${day} ${month} *`;
                } else {
                    // Don't generate cron if date is not set
                    return;
                }
                break;
            case "daily":
                cron = `${minute} ${hour} * * *`;
                break;
            case "weekly":
                // Join weekdays with comma if multiple selected
                const weekdayStr = weekdays.length > 0 ? weekdays.join(",") : "0";
                cron = `${minute} ${hour} * * ${weekdayStr}`;
                break;
            case "monthly":
                cron = `${minute} ${hour} ${dayOfMonth} * *`;
                break;
        }

        // Only call onChange if the cron has actually changed from what we last generated
        // This prevents infinite loops: we only update if the cron differs from our last output
        if (cron && cron !== previousCronRef.current) {
            previousCronRef.current = cron;
            onChange(cron);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frequency, hour, minute, weekdays, dayOfMonth, oneTimeDate]); // onChange is intentionally excluded - it's an unstable reference

    // Validation logic
    useEffect(() => {
        let isValid = true;
        switch (frequency) {
            case "one-time":
                isValid = !!oneTimeDate && !!hour && !!minute;
                break;
            case "daily":
                isValid = !!hour && !!minute;
                break;
            case "weekly":
                isValid = !!hour && !!minute && weekdays.length > 0;
                break;
            case "monthly":
                isValid = !!dayOfMonth && !!hour && !!minute;
                break;
        }
        onValidationChange?.(isValid);
    }, [frequency, hour, minute, weekdays, dayOfMonth, oneTimeDate, onValidationChange]);

    // Calculate next execution time from a cron expression
    const getNextExecutionTime = (cronExpression: string, fromDate: Date): Date | null => {
        const parts = cronExpression.trim().split(/\s+/);
        if (parts.length !== 5) {
            return null; // Invalid cron expression
        }

        const [minuteField, hourField, dayField, monthField, weekdayField] = parts;

        try {
            const minutes = parseCronField(minuteField, 0, 59);
            const hours = parseCronField(hourField, 0, 23);
            const days = parseCronField(dayField, 1, 31);
            const months = parseCronField(monthField, 1, 12);
            const weekdays = parseCronField(weekdayField, 0, 6);

            const isDayWildcard = dayField === "*";
            const isWeekdayWildcard = weekdayField === "*";

            let current = new Date(fromDate);
            current.setSeconds(0);
            current.setMilliseconds(0);

            // Store the original fromDate for comparison (with seconds/milliseconds)
            const fromDateWithTime = new Date(fromDate);

            // Try up to 2 years ahead
            for (let attempts = 0; attempts < 730; attempts++) {
                const currentMonth = current.getMonth() + 1; // getMonth() returns 0-11
                const currentDay = current.getDate();
                const currentWeekday = current.getDay();
                const currentHour = current.getHours();
                const currentMinute = current.getMinutes();

                // Check if month matches
                if (!months.includes(currentMonth)) {
                    // Find next matching month
                    const nextMonth = months.find(m => m > currentMonth) || months[0];
                    if (nextMonth > currentMonth) {
                        current.setMonth(nextMonth - 1); // setMonth expects 0-11
                    } else {
                        // Wrap to next year
                        current.setFullYear(current.getFullYear() + 1);
                        current.setMonth(nextMonth - 1);
                    }
                    current.setDate(1);
                    current.setHours(0);
                    current.setMinutes(0);
                    continue;
                }

                // Check if day matches (considering both day of month and weekday)
                // Standard cron: if both specified, match if EITHER matches (OR logic)
                let dayMatches = false;
                if (isDayWildcard && isWeekdayWildcard) {
                    dayMatches = true; // Both wildcards, any day matches
                } else if (isDayWildcard) {
                    dayMatches = weekdays.includes(currentWeekday); // Only check weekday
                } else if (isWeekdayWildcard) {
                    dayMatches = days.includes(currentDay); // Only check day of month
                } else {
                    // Both specified: match if either matches (standard cron behavior)
                    dayMatches = days.includes(currentDay) || weekdays.includes(currentWeekday);
                }

                if (!dayMatches) {
                    current.setDate(current.getDate() + 1);
                    current.setHours(0);
                    current.setMinutes(0);
                    continue;
                }

                // Check if hour matches
                if (!hours.includes(currentHour)) {
                    const nextHour = hours.find(h => h > currentHour);
                    if (nextHour !== undefined) {
                        current.setHours(nextHour);
                        current.setMinutes(0);
                    } else {
                        // Move to next day
                        current.setDate(current.getDate() + 1);
                        current.setHours(hours[0]);
                        current.setMinutes(0);
                    }
                    continue;
                }

                // Check if minute matches
                const matchingMinutes = minutes.filter(m => m >= currentMinute);
                if (matchingMinutes.length > 0) {
                    current.setMinutes(matchingMinutes[0]);
                    // Ensure we return a time strictly in the future (compare with original fromDate)
                    if (current > fromDateWithTime) {
                        return current;
                    }
                    // If current minute matches but time is not in future, try next matching minute
                    if (matchingMinutes.length > 1) {
                        current.setMinutes(matchingMinutes[1]);
                        if (current > fromDateWithTime) {
                            return current;
                        }
                    }
                }

                // No matching minute in this hour, move to next hour
                const nextHour = hours.find(h => h > currentHour);
                if (nextHour !== undefined) {
                    current.setHours(nextHour);
                    current.setMinutes(minutes[0]);
                } else {
                    // Move to next day
                    current.setDate(current.getDate() + 1);
                    current.setHours(hours[0]);
                    current.setMinutes(minutes[0]);
                }
            }

            return null; // Could not find next execution time
        } catch (error) {
            return null; // Invalid cron expression
        }
    };

    // Calculate next 5 scheduled times based on frequency
    const nextScheduledTimes = useMemo(() => {
        const times: Date[] = [];
        const now = new Date();

        for (let i = 0; i < 5; i++) {
            let nextTime: Date | null = null;

            switch (frequency) {
                case "one-time":
                    // One-time execution at specified date and time
                    if (oneTimeDate && i === 0) {
                        const oneTime = new Date(oneTimeDate);
                        oneTime.setHours(parseInt(hour));
                        oneTime.setMinutes(parseInt(minute));
                        oneTime.setSeconds(0);
                        oneTime.setMilliseconds(0);
                        if (oneTime > now) {
                            nextTime = oneTime;
                        }
                    }
                    break;
                case "daily":
                    // At specified hour:minute each day
                    const dailyTime = new Date(now);
                    dailyTime.setHours(parseInt(hour));
                    dailyTime.setMinutes(parseInt(minute));
                    dailyTime.setSeconds(0);
                    dailyTime.setMilliseconds(0);
                    if (i === 0 && dailyTime <= now) {
                        dailyTime.setDate(dailyTime.getDate() + 1);
                    } else if (i > 0) {
                        dailyTime.setDate(times[i - 1].getDate() + 1);
                    }
                    nextTime = dailyTime;
                    break;
                case "weekly":
                    // On specified weekdays at specified time
                    const weeklyTime = new Date(now);
                    weeklyTime.setHours(parseInt(hour));
                    weeklyTime.setMinutes(parseInt(minute));
                    weeklyTime.setSeconds(0);
                    weeklyTime.setMilliseconds(0);
                    const targetWeekdays = weekdays.map(w => parseInt(w));
                    if (i === 0) {
                        const currentWeekday = weeklyTime.getDay();
                        // Find next matching weekday
                        let daysUntilTarget = 7;
                        for (const targetWeekday of targetWeekdays) {
                            let days = (targetWeekday - currentWeekday + 7) % 7;
                            if (days === 0 && weeklyTime <= now) {
                                days = 7; // Move to next week
                            }
                            daysUntilTarget = Math.min(daysUntilTarget, days);
                        }
                        weeklyTime.setDate(weeklyTime.getDate() + daysUntilTarget);
                    } else {
                        // Find next weekday from the selected weekdays
                        const lastWeekday = times[i - 1].getDay();
                        let daysUntilNext = 7;
                        for (const targetWeekday of targetWeekdays) {
                            let days = (targetWeekday - lastWeekday + 7) % 7;
                            if (days === 0) days = 7;
                            daysUntilNext = Math.min(daysUntilNext, days);
                        }
                        weeklyTime.setDate(times[i - 1].getDate() + daysUntilNext);
                    }
                    nextTime = weeklyTime;
                    break;
                case "monthly":
                    // On specified day of month at specified time
                    const monthlyTime = new Date(now);
                    monthlyTime.setHours(parseInt(hour));
                    monthlyTime.setMinutes(parseInt(minute));
                    monthlyTime.setSeconds(0);
                    monthlyTime.setMilliseconds(0);
                    const targetDay = parseInt(dayOfMonth);
                    if (i === 0) {
                        const currentDay = monthlyTime.getDate();
                        if (currentDay < targetDay) {
                            monthlyTime.setDate(targetDay);
                        } else if (currentDay > targetDay || monthlyTime <= now) {
                            // Move to next month
                            monthlyTime.setMonth(monthlyTime.getMonth() + 1);
                            monthlyTime.setDate(targetDay);
                        }
                    } else {
                        // Move to next month
                        monthlyTime.setMonth(times[i - 1].getMonth() + 1);
                        monthlyTime.setDate(targetDay);
                    }
                    nextTime = monthlyTime;
                    break;
            }

            if (nextTime) {
                times.push(nextTime);
            } else {
                // If we can't calculate more times, break
                break;
            }
        }

        return times;
    }, [frequency, hour, minute, weekdays, dayOfMonth, oneTimeDate, value]);

    // Format date for display
    const formatScheduledTime = (date: Date): string => {
        return date.toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
    };

    const dayOfMonthOptions: InputSelectOption[] = useMemo(() => {
        const pr = new Intl.PluralRules("en-US", { type: "ordinal" });
        const suffixes: Record<string, string> = {
            one: "st",
            two: "nd",
            few: "rd",
            other: "th",
        };

        return Array.from({ length: 31 }, (_, i) => {
            const day = i + 1;
            const rule = pr.select(day);
            const suffix = suffixes[rule];
            return {
                value: day.toString(),
                label: `${day}${suffix}`,
            };
        });
    }, []);

    return (
        <div className="w-full h-full flex flex-col space-y-4">
            <Tabs value={frequency} onValueChange={(value) => setFrequency(value as FrequencyType)} className="flex-1">
                <TabsList className="w-full grid grid-cols-4">
                    <TabsTrigger value="one-time" className="text-body-sm">
                        {t("triggers.frequency-one-time")}
                    </TabsTrigger>
                    <TabsTrigger value="daily" className="text-body-sm">
                        {t("triggers.frequency-daily")}
                    </TabsTrigger>
                    <TabsTrigger value="weekly" className="text-body-sm">
                        {t("triggers.frequency-weekly")}
                    </TabsTrigger>
                    <TabsTrigger value="monthly" className="text-body-sm">
                        {t("triggers.frequency-monthly")}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="one-time" className="space-y-3 mt-4">
                    <Input
                        type="date"
                        title={t("triggers.schedule-date")}
                        value={oneTimeDate ? format(oneTimeDate, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                            const val = e.target.value;
                            setOneTimeDate(val ? parse(val, "yyyy-MM-dd", new Date()) : undefined);
                        }}
                        placeholder={t("triggers.select-date")}
                        min={format(new Date(), "yyyy-MM-dd")}
                        required
                        state={showErrors && !oneTimeDate ? "error" : "default"}
                        note={showErrors && !oneTimeDate ? t("triggers.date-required") : undefined}
                    />
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <InputSelect
                                value={hour}
                                onChange={(value) => setHour(value)}
                                options={hourOptions}
                                title={t("triggers.schedule-hour")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !hour ? "error" : undefined}
                            />
                        </div>
                        <div className="flex-1">
                            <InputSelect
                                value={minute}
                                onChange={(value) => setMinute(value)}
                                options={minuteOptions}
                                title={t("triggers.schedule-minute")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !minute ? "error" : undefined}
                            />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="daily" className="space-y-3 mt-4">
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <InputSelect
                                value={hour}
                                onChange={(value) => setHour(value)}
                                options={hourOptions}
                                title={t("triggers.schedule-hour")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !hour ? "error" : undefined}
                            />
                        </div>
                        <div className="flex-1">
                            <InputSelect
                                value={minute}
                                onChange={(value) => setMinute(value)}
                                options={minuteOptions}
                                title={t("triggers.schedule-minute")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !minute ? "error" : undefined}
                            />
                        </div>
                    </div>
                    <Input
                        type="date"
                        title={t("triggers.expiration-date")}
                        value={expiredAt ? format(expiredAt, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                            const val = e.target.value;
                            setExpiredAt(val ? parse(val, "yyyy-MM-dd", new Date()) : undefined);
                        }}
                        placeholder={t("triggers.select-expiration")}
                        min={format(new Date(), "yyyy-MM-dd")}
                    />
                </TabsContent>

                <TabsContent value="weekly" className="space-y-3 mt-4">
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <InputSelect
                                value={hour}
                                onChange={(value) => setHour(value)}
                                options={hourOptions}
                                title={t("triggers.schedule-hour")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !hour ? "error" : undefined}
                            />
                        </div>
                        <div className="flex-1">
                            <InputSelect
                                value={minute}
                                onChange={(value) => setMinute(value)}
                                options={minuteOptions}
                                title={t("triggers.schedule-minute")}
                                placeholder="00"
                                required
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !minute ? "error" : undefined}
                            />
                        </div>
                    </div>
                    <div>
                        <div className="mb-1.5 text-body-sm font-bold text-text-heading">
                            {t("triggers.schedule-weekdays")} *
                        </div>
                        <ToggleGroup
                            type="multiple"
                            value={weekdays}
                            onValueChange={(values) => {
                                // Ensure at least one weekday is always selected
                                if (values.length > 0) {
                                    setWeekdays(values);
                                } else {
                                    // If trying to deselect all, keep the current selection
                                    // This prevents having no weekdays selected
                                }
                            }}
                            className="flex flex-wrap gap-2"
                        >
                            <ToggleGroupItem value="0" className="flex-1" aria-label={t("triggers.weekday-sunday")}>
                                {t("triggers.weekday-sunday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="1" className="flex-1" aria-label={t("triggers.weekday-monday")}>
                                {t("triggers.weekday-monday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="2" className="flex-1" aria-label={t("triggers.weekday-tuesday")}>
                                {t("triggers.weekday-tuesday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="3" className="flex-1" aria-label={t("triggers.weekday-wednesday")}>
                                {t("triggers.weekday-wednesday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="4" className="flex-1" aria-label={t("triggers.weekday-thursday")}>
                                {t("triggers.weekday-thursday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="5" className="flex-1" aria-label={t("triggers.weekday-friday")}>
                                {t("triggers.weekday-friday")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="6" className="flex-1" aria-label={t("triggers.weekday-saturday")}>
                                {t("triggers.weekday-saturday")}
                            </ToggleGroupItem>
                        </ToggleGroup>
                        {showErrors && weekdays.length === 0 && (
                            <div className="mt-1 text-xs text-text-cuation">{t("triggers.weekday-required")}</div>
                        )}
                    </div>
                    <Input
                        type="date"
                        title={t("triggers.expiration-date")}
                        value={expiredAt ? format(expiredAt, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                            const val = e.target.value;
                            setExpiredAt(val ? parse(val, "yyyy-MM-dd", new Date()) : undefined);
                        }}
                        placeholder={t("triggers.select-expiration")}
                        min={format(new Date(), "yyyy-MM-dd")}
                    />
                </TabsContent>

                <TabsContent value="monthly" className="space-y-3 mt-4">
                    <InputSelect
                        value={dayOfMonth}
                        onChange={(value) => setDayOfMonth(value)}
                        options={dayOfMonthOptions}
                        title={t("triggers.schedule-day-of-month")}
                        placeholder={t("triggers.select-day")}
                        note={t("triggers.schedule-day-of-month-note")}
                        required
                        state={showErrors && !dayOfMonth ? "error" : undefined}
                    />
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <InputSelect
                                value={hour}
                                onChange={(value) => setHour(value)}
                                options={hourOptions}
                                title={t("triggers.schedule-hour")}
                                required
                                placeholder="00"
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !hour ? "error" : undefined}
                            />
                        </div>
                        <div className="flex-1">
                            <InputSelect
                                value={minute}
                                onChange={(value) => setMinute(value)}
                                options={minuteOptions}
                                title={t("triggers.schedule-minute")}
                                required
                                placeholder="00"
                                leadingIcon={<Clock className="h-4 w-4" />}
                                state={showErrors && !minute ? "error" : undefined}
                            />
                        </div>
                    </div>
                    <Input
                        type="date"
                        title={t("triggers.expiration-date")}
                        value={expiredAt ? format(expiredAt, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                            const val = e.target.value;
                            setExpiredAt(val ? parse(val, "yyyy-MM-dd", new Date()) : undefined);
                        }}
                        placeholder={t("triggers.select-expiration")}
                        min={format(new Date(), "yyyy-MM-dd")}
                    />
                </TabsContent>
            </Tabs>

            {/* Scheduled Times Preview */}
            <Accordion type="single" collapsible className="w-full mt-auto">
                <AccordionItem value="scheduled-times" className="border-none">
                    <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                        <span className="font-bold text-sm text-text-heading">{t("triggers.preview-scheduled-times")}</span>
                    </AccordionTrigger>
                    <AccordionContent>
                        <div className="bg-surface-primary rounded-lg p-4 space-y-2">
                            {nextScheduledTimes.map((time, index) => (
                                <div key={index} className="flex items-center gap-2 text-text-body text-label-sm">
                                    <span className="text-text-label font-mono text-xs w-5">
                                        {String(index + 1).padStart(2, '0')}
                                    </span>
                                    <span>{formatScheduledTime(time)}</span>
                                </div>
                            ))}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
};
