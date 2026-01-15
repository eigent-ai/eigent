import { useState, useEffect, useMemo } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";

type FrequencyType = "hourly" | "daily" | "weekly" | "custom";

type SchedulePickerProps = {
    value: string; // cron expression
    onChange: (cronExpression: string) => void;
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
    value,
    onChange,
}) => {
    const { t } = useTranslation();
    const [frequency, setFrequency] = useState<FrequencyType>("hourly");
    const [hour, setHour] = useState<string>("0");
    const [minute, setMinute] = useState<string>("0");

    // Parse initial cron expression
    useEffect(() => {
        if (value) {
            // Simple parsing - can be enhanced
            if (value === "0 */1 * * *") {
                setFrequency("hourly");
            } else if (value.match(/^\d+ \d+ \* \* \*$/)) {
                setFrequency("daily");
                const parts = value.split(" ");
                setMinute(parts[0]);
                setHour(parts[1]);
            }
        }
    }, [value]);

    // Generate cron expression based on frequency
    useEffect(() => {
        // Don't update if frequency is custom - let the user control the value directly
        if (frequency === "custom") {
            return;
        }
        
        let cron = "";
        switch (frequency) {
            case "hourly":
                cron = "0 */1 * * *";
                break;
            case "daily":
                cron = `${minute} ${hour} * * *`;
                break;
            case "weekly":
                cron = `${minute} ${hour} * * 0`; // Sunday
                break;
        }
        onChange(cron);
    }, [frequency, hour, minute]);

    // Parse cron field (minute, hour, day, month, weekday)
    const parseCronField = (field: string, min: number, max: number): number[] => {
        if (field === "*") {
            return Array.from({ length: max - min + 1 }, (_, i) => i + min);
        }

        const values: number[] = [];
        const parts = field.split(",");

        for (const part of parts) {
            if (part.includes("/")) {
                // Step values: */5, 0-59/15
                const [range, step] = part.split("/");
                const stepNum = parseInt(step);
                
                if (range === "*") {
                    for (let i = min; i <= max; i += stepNum) {
                        values.push(i);
                    }
                } else if (range.includes("-")) {
                    const [start, end] = range.split("-").map(Number);
                    for (let i = start; i <= end; i += stepNum) {
                        values.push(i);
                    }
                } else {
                    const start = parseInt(range);
                    for (let i = start; i <= max; i += stepNum) {
                        values.push(i);
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
    };

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
                case "hourly":
                    // Move to next hour
                    const hourlyTime = new Date(now);
                    hourlyTime.setMinutes(0);
                    hourlyTime.setSeconds(0);
                    hourlyTime.setMilliseconds(0);
                    if (i === 0) {
                        if (hourlyTime <= now) {
                            hourlyTime.setHours(hourlyTime.getHours() + 1);
                        }
                    } else {
                        hourlyTime.setHours(times[i - 1].getHours() + 1);
                    }
                    nextTime = hourlyTime;
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
                    // Every Sunday at specified time
                    const weeklyTime = new Date(now);
                    weeklyTime.setHours(parseInt(hour));
                    weeklyTime.setMinutes(parseInt(minute));
                    weeklyTime.setSeconds(0);
                    weeklyTime.setMilliseconds(0);
                    if (i === 0) {
                        const daysUntilSunday = (7 - weeklyTime.getDay()) % 7;
                        if (daysUntilSunday === 0 && weeklyTime <= now) {
                            weeklyTime.setDate(weeklyTime.getDate() + 7);
                        } else {
                            weeklyTime.setDate(weeklyTime.getDate() + daysUntilSunday);
                        }
                    } else {
                        weeklyTime.setDate(times[i - 1].getDate() + 7);
                    }
                    nextTime = weeklyTime;
                    break;
                case "custom":
                    // Parse custom cron expression
                    if (i === 0) {
                        nextTime = getNextExecutionTime(value || "0 */1 * * *", now);
                    } else if (times[i - 1]) {
                        nextTime = getNextExecutionTime(value || "0 */1 * * *", times[i - 1]);
                    }
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
    }, [frequency, hour, minute, value]);

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

    const hours = Array.from({ length: 24 }, (_, i) => i.toString());
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString());

    return (
        <div className="w-full space-y-4">
            <div className="space-y-2">
                <Select
                    value={frequency}
                    onValueChange={(value: FrequencyType) => setFrequency(value)}
                >
                    <SelectTrigger title={t("triggers.schedule-frequency")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="hourly">
                            {t("triggers.frequency-hourly")}
                        </SelectItem>
                        <SelectItem value="daily">
                            {t("triggers.frequency-daily")}
                        </SelectItem>
                        <SelectItem value="weekly">
                            {t("triggers.frequency-weekly")}
                        </SelectItem>
                        <SelectItem value="custom">
                            {t("triggers.frequency-custom")}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {(frequency === "daily" || frequency === "weekly") && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Select value={hour} onValueChange={setHour}>
                            <SelectTrigger title={t("triggers.schedule-time")}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {hours.map((h) => (
                                    <SelectItem key={h} value={h}>
                                        {h.padStart(2, "0")}:00
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Select value={minute} onValueChange={setMinute}>
                            <SelectTrigger title={t("triggers.schedule-time")}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {minutes.filter((m) => parseInt(m) % 15 === 0).map((m) => (
                                    <SelectItem key={m} value={m}>
                                        :{m.padStart(2, "0")}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {frequency === "custom" && (
                <Input
                    title={t("triggers.cron-expression")}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="0 */1 * * *"
                    note={t("triggers.cron-help")}
                />
            )}
            {/* Scheduled Times Preview */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-text-heading text-label-sm">
                    <span className="font-bold">{t("triggers.upcoming-executions")}</span>
                </div>
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
            </div>
        </div>
    );
};
