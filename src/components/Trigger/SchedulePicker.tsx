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
            case "custom":
                cron = value || "0 */1 * * *";
                break;
        }
        onChange(cron);
    }, [frequency, hour, minute]);

    // Calculate next 5 scheduled times based on frequency
    const nextScheduledTimes = useMemo(() => {
        const times: Date[] = [];
        const now = new Date();
        let current = new Date(now);

        // Start from the next occurrence
        current.setSeconds(0);
        current.setMilliseconds(0);

        for (let i = 0; i < 5; i++) {
            const nextTime = new Date(current);

            switch (frequency) {
                case "hourly":
                    // Move to next hour
                    if (i === 0) {
                        nextTime.setMinutes(0);
                        if (nextTime <= now) {
                            nextTime.setHours(nextTime.getHours() + 1);
                        }
                    } else {
                        nextTime.setHours(times[i - 1].getHours() + 1);
                        nextTime.setMinutes(0);
                    }
                    break;
                case "daily":
                    // At specified hour:minute each day
                    nextTime.setHours(parseInt(hour));
                    nextTime.setMinutes(parseInt(minute));
                    if (i === 0 && nextTime <= now) {
                        nextTime.setDate(nextTime.getDate() + 1);
                    } else if (i > 0) {
                        nextTime.setDate(times[i - 1].getDate() + 1);
                    }
                    break;
                case "weekly":
                    // Every Sunday at specified time
                    nextTime.setHours(parseInt(hour));
                    nextTime.setMinutes(parseInt(minute));
                    if (i === 0) {
                        const daysUntilSunday = (7 - nextTime.getDay()) % 7;
                        if (daysUntilSunday === 0 && nextTime <= now) {
                            nextTime.setDate(nextTime.getDate() + 7);
                        } else {
                            nextTime.setDate(nextTime.getDate() + daysUntilSunday);
                        }
                    } else {
                        nextTime.setDate(times[i - 1].getDate() + 7);
                    }
                    break;
                case "custom":
                    // For custom, just show hourly as placeholder
                    if (i === 0) {
                        nextTime.setMinutes(0);
                        if (nextTime <= now) {
                            nextTime.setHours(nextTime.getHours() + 1);
                        }
                    } else {
                        nextTime.setHours(times[i - 1].getHours() + 1);
                        nextTime.setMinutes(0);
                    }
                    break;
            }

            times.push(new Date(nextTime));
            current = new Date(nextTime);
        }

        return times;
    }, [frequency, hour, minute]);

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
        <div className="w-full space-y-4 bg-surface-disabled rounded-lg p-4">
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
