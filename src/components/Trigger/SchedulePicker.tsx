import { useState, useEffect, useMemo, useCallback } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { InputSelect, type InputSelectOption } from "@/components/ui/input-select";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

type FrequencyType = "hourly" | "daily" | "weekly" | "custom";

type SchedulePickerProps = {
    value: string; // cron expression
    onChange: (cronExpression: string) => void;
};

type TimePickerInputProps = {
    hour: string;
    minute: string;
    onTimeChange: (hour: string, minute: string) => void;
    title?: string;
};

const TimePickerInput: React.FC<TimePickerInputProps> = ({
    hour,
    minute,
    onTimeChange,
    title,
}) => {
    const { t } = useTranslation();
    
    // Generate hourly time options (00:00 to 23:00)
    const hourlyOptions: InputSelectOption[] = Array.from({ length: 24 }, (_, i) => ({
        value: `${i}:0`, // Store as "hour:minute" for easy parsing
        label: `${i.toString().padStart(2, "0")}:00`,
    }));

    // Current display value
    const displayValue = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

    // Handle value change from input
    const handleChange = (value: string) => {
        // This is called when input value changes directly
        // We don't update immediately - wait for commit
    };

    // Handle option selection from dropdown
    const handleOptionSelect = (option: InputSelectOption) => {
        const [h, m] = option.value.split(":");
        onTimeChange(h, m);
    };

    // Validate and parse the input value
    const handleInputCommit = (value: string): string | false => {
        // Try to parse HH:MM format
        const match = value.match(/^(\d{1,2}):?(\d{0,2})$/);
        if (match) {
            let h = parseInt(match[1], 10);
            let m = match[2] ? parseInt(match[2], 10) : 0;
            
            // Check if values are within valid range
            if (h > 23 || m > 59) {
                return false; // Invalid - show error state
            }
            
            onTimeChange(h.toString(), m.toString());
            return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
        }
        // Invalid input format - return false to show error
        return false;
    };

    return (
        <InputSelect
            value={displayValue}
            onChange={handleChange}
            options={hourlyOptions}
            title={title}
            placeholder="00:00"
            leadingIcon={<Clock className="h-4 w-4" />}
            maxDropdownHeight={200}
            onOptionSelect={handleOptionSelect}
            onInputCommit={handleInputCommit}
            errorNote={t("triggers.invalid-time-format")}
        />
    );
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
    value,
    onChange,
}) => {
    const { t } = useTranslation();
    const [frequency, setFrequency] = useState<FrequencyType>("hourly");
    const [hour, setHour] = useState<string>("0");
    const [minute, setMinute] = useState<string>("0");
    const [weekday, setWeekday] = useState<string>("0"); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const [cronError, setCronError] = useState<string | null>(null);

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

    // Parse initial cron expression
    useEffect(() => {
        if (value) {
            // Simple parsing - can be enhanced
            if (value === "0 */1 * * *") {
                setFrequency("hourly");
                setCronError(null);
            } else if (value.match(/^\d+ \d+ \* \* \d+$/)) {
                // Weekly: minute hour * * weekday
                setFrequency("weekly");
                const parts = value.split(" ");
                setMinute(parts[0]);
                setHour(parts[1]);
                setWeekday(parts[4]);
                setCronError(null);
            } else if (value.match(/^\d+ \d+ \* \* \*$/)) {
                // Daily: minute hour * * *
                setFrequency("daily");
                const parts = value.split(" ");
                setMinute(parts[0]);
                setHour(parts[1]);
                setCronError(null);
            } else {
                // Custom cron - validate it
                setFrequency("custom");
                const error = validateCronExpression(value);
                setCronError(error);
            }
        }
    }, [value, validateCronExpression]);

    // Validate cron when switching to custom mode
    useEffect(() => {
        if (frequency === "custom" && value) {
            const error = validateCronExpression(value);
            setCronError(error);
        } else if (frequency !== "custom") {
            setCronError(null);
        }
    }, [frequency, value, validateCronExpression]);

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
                cron = `${minute} ${hour} * * ${weekday}`;
                break;
        }
        onChange(cron);
    }, [frequency, hour, minute, weekday]);

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
                    // On specified weekday at specified time
                    const weeklyTime = new Date(now);
                    weeklyTime.setHours(parseInt(hour));
                    weeklyTime.setMinutes(parseInt(minute));
                    weeklyTime.setSeconds(0);
                    weeklyTime.setMilliseconds(0);
                    const targetWeekday = parseInt(weekday);
                    if (i === 0) {
                        const currentWeekday = weeklyTime.getDay();
                        let daysUntilTarget = (targetWeekday - currentWeekday + 7) % 7;
                        if (daysUntilTarget === 0 && weeklyTime <= now) {
                            daysUntilTarget = 7; // Move to next week
                        }
                        weeklyTime.setDate(weeklyTime.getDate() + daysUntilTarget);
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
    }, [frequency, hour, minute, weekday, value]);

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
                <div className="flex items-end gap-3">
                    <div className="flex-1">
                        <TimePickerInput
                            hour={hour}
                            minute={minute}
                            onTimeChange={(h, m) => {
                                setHour(h);
                                setMinute(m);
                            }}
                            title={t("triggers.schedule-time")}
                        />
                    </div>
                    <div className="flex-1">
                        <Select
                            value={weekday}
                            onValueChange={setWeekday}
                        >
                            <SelectTrigger 
                                title={t("triggers.schedule-weekday")}
                                disabled={frequency === "daily"}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0">{t("triggers.weekday-sunday")}</SelectItem>
                                <SelectItem value="1">{t("triggers.weekday-monday")}</SelectItem>
                                <SelectItem value="2">{t("triggers.weekday-tuesday")}</SelectItem>
                                <SelectItem value="3">{t("triggers.weekday-wednesday")}</SelectItem>
                                <SelectItem value="4">{t("triggers.weekday-thursday")}</SelectItem>
                                <SelectItem value="5">{t("triggers.weekday-friday")}</SelectItem>
                                <SelectItem value="6">{t("triggers.weekday-saturday")}</SelectItem>
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
                    onChange={(e) => {
                        const newValue = e.target.value;
                        const error = validateCronExpression(newValue);
                        setCronError(error);
                        // Auto-save even if there's an error, so user can see the error state
                        onChange(newValue);
                    }}
                    placeholder="0 */1 * * *"
                    note={cronError || t("triggers.cron-help")}
                    state={cronError ? "error" : "default"}
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
