import { useState, useEffect } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

type FrequencyType = "once" | "daily" | "weekly" | "monthly";

type SchedulePickerProps = {
    value: string; // cron expression or schedule data
    onChange: (cronExpression: string) => void;
    onValidationChange?: (isValid: boolean) => void;
};

type ValidationErrors = {
    date?: string;
    time?: string;
    weekdays?: string;
    monthDay?: string;
    expirationDate?: string;
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
    value,
    onChange,
    onValidationChange,
}) => {
    const { t } = useTranslation();
    const [frequency, setFrequency] = useState<FrequencyType>("once");
    const [date, setDate] = useState<string>("");
    const [time, setTime] = useState<string>("");
    const [hour, setHour] = useState<string>("00");
    const [minute, setMinute] = useState<string>("00");
    const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
    const [monthDay, setMonthDay] = useState<string>("1");
    const [expirationDate, setExpirationDate] = useState<string>("");
    const [errors, setErrors] = useState<ValidationErrors>({});

    const weekdays = [
        { value: 1, label: t("triggers.weekday-monday") || "Monday" },
        { value: 2, label: t("triggers.weekday-tuesday") || "Tuesday" },
        { value: 3, label: t("triggers.weekday-wednesday") || "Wednesday" },
        { value: 4, label: t("triggers.weekday-thursday") || "Thursday" },
        { value: 5, label: t("triggers.weekday-friday") || "Friday" },
        { value: 6, label: t("triggers.weekday-saturday") || "Saturday" },
        { value: 0, label: t("triggers.weekday-sunday") || "Sunday" },
    ];

    // Sync hour and minute to time
    useEffect(() => {
        setTime(`${hour}:${minute}`);
    }, [hour, minute]);

    // Parse initial cron expression
    useEffect(() => {
        if (value) {
            // Try to parse existing cron expression
            // This is a simplified parser - you may need to enhance it
            if (value.match(/^\d+ \d+ \* \* \*$/)) {
                setFrequency("daily");
                const parts = value.split(" ");
                const m = parts[0];
                const h = parts[1];
                setHour(h.padStart(2, "0"));
                setMinute(m.padStart(2, "0"));
            }
        }
    }, [value]);

    // Validation logic
    const validateInputs = (): boolean => {
        const newErrors: ValidationErrors = {};
        let isValid = true;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (frequency === "once") {
            // Validate date
            if (!date) {
                newErrors.date = t("triggers.date-required") || "Date is required";
                isValid = false;
            } else {
                const selectedDate = new Date(date);
                if (selectedDate < today) {
                    newErrors.date = t("triggers.error-past-date") || "Please select today or a future date";
                    isValid = false;
                }
            }

            // Validate time
            if (!time) {
                newErrors.time = t("triggers.time-required") || "Time is required";
                isValid = false;
            } else if (date) {
                const selectedDate = new Date(date);
                const [hours, minutes] = time.split(":").map(Number);
                const selectedDateTime = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes);

                // Check if selected time is in the past for today
                if (selectedDate.getTime() === today.getTime() && selectedDateTime <= now) {
                    newErrors.time = t("triggers.error-past-time") || "For today's tasks, please select current time or future time";
                    isValid = false;
                }
            }
        }

        if (frequency === "daily") {
            // Validate time
            if (!time) {
                newErrors.time = t("triggers.time-required") || "Time is required";
                isValid = false;
            }

            // Validate expiration date (optional, but if provided must be valid)
            if (expirationDate) {
                const expDate = new Date(expirationDate);
                if (expDate < today) {
                    newErrors.expirationDate = t("triggers.error-past-date") || "Please select today or a future date";
                    isValid = false;
                }
            }
        }

        if (frequency === "weekly") {
            // Validate time
            if (!time) {
                newErrors.time = t("triggers.time-required") || "Time is required";
                isValid = false;
            }

            // Validate weekdays
            if (selectedWeekdays.length === 0) {
                newErrors.weekdays = t("triggers.weekdays-required") || "Please select at least one weekday";
                isValid = false;
            }

            // Validate expiration date (optional, but if provided must be valid)
            if (expirationDate) {
                const expDate = new Date(expirationDate);
                if (expDate < today) {
                    newErrors.expirationDate = t("triggers.error-past-date") || "Please select today or a future date";
                    isValid = false;
                }
            }
        }

        if (frequency === "monthly") {
            // Validate time
            if (!time) {
                newErrors.time = t("triggers.time-required") || "Time is required";
                isValid = false;
            }

            // Validate month day
            if (!monthDay) {
                newErrors.monthDay = t("triggers.month-day-required") || "Day of month is required";
                isValid = false;
            } else {
                const day = parseInt(monthDay);
                if (day < 1 || day > 31) {
                    newErrors.monthDay = t("triggers.invalid-month-day") || "Please select a day between 1 and 31";
                    isValid = false;
                }
            }

            // Validate expiration date (optional, but if provided must be valid)
            if (expirationDate) {
                const expDate = new Date(expirationDate);
                if (expDate < today) {
                    newErrors.expirationDate = t("triggers.error-past-date") || "Please select today or a future date";
                    isValid = false;
                }
            }
        }

        setErrors(newErrors);
        return isValid;
    };

    // Generate cron expression based on frequency
    useEffect(() => {
        const isValid = validateInputs();
        onValidationChange?.(isValid);

        if (!isValid) {
            return;
        }

        let cron = "";
        const [hour, minute] = time ? time.split(":") : ["0", "0"];

        switch (frequency) {
            case "once":
                // For once, we'll use a special format with date
                // Format: minute hour day month * (single execution)
                if (date && time) {
                    const d = new Date(date);
                    const day = d.getDate();
                    const month = d.getMonth() + 1;
                    cron = `${minute} ${hour} ${day} ${month} *`;
                }
                break;
            case "daily":
                // Daily at specified time
                cron = `${minute} ${hour} * * *`;
                break;
            case "weekly":
                // Weekly on selected days at specified time
                if (selectedWeekdays.length > 0) {
                    const sortedWeekdays = [...selectedWeekdays].sort((a, b) => a - b);
                    cron = `${minute} ${hour} * * ${sortedWeekdays.join(",")}`;
                }
                break;
            case "monthly":
                // Monthly on specific day at specified time
                if (monthDay && time) {
                    cron = `${minute} ${hour} ${monthDay} * *`;
                }
                break;
        }

        if (cron) {
            onChange(cron);
        }
    }, [frequency, date, time, selectedWeekdays, monthDay, expirationDate]);

    const handleWeekdayToggle = (day: number) => {
        setSelectedWeekdays((prev) => {
            if (prev.includes(day)) {
                return prev.filter((d) => d !== day);
            } else {
                return [...prev, day];
            }
        });
    };

    const getTodayString = (): string => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const getOrdinalSuffix = (day: number): string => {
        if (day >= 11 && day <= 13) {
            return "th";
        }
        switch (day % 10) {
            case 1:
                return "st";
            case 2:
                return "nd";
            case 3:
                return "rd";
            default:
                return "th";
        }
    };

    // Generate hour options (00-23)
    const hourOptions = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));

    // Generate minute options (00-59)
    const minuteOptions = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"));

    return (
        <div className="w-full space-y-4">
            {/* Frequency Selector */}
            <div className="space-y-2">
                <Label className="font-bold text-sm">{t("triggers.schedule-mode") || "Schedule"}</Label>
                <Select
                    value={frequency}
                    onValueChange={(value: FrequencyType) => {
                        setFrequency(value);
                        // Reset fields when changing frequency
                        setErrors({});
                        setDate("");
                        setTime("");
                        setHour("00");
                        setMinute("00");
                        setSelectedWeekdays([]);
                        setMonthDay("1");
                        setExpirationDate("");
                    }}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="once">
                            {t("triggers.frequency-once") || "Once"}
                        </SelectItem>
                        <SelectItem value="daily">
                            {t("triggers.frequency-daily") || "Daily"}
                        </SelectItem>
                        <SelectItem value="weekly">
                            {t("triggers.frequency-weekly") || "Weekly"}
                        </SelectItem>
                        <SelectItem value="monthly">
                            {t("triggers.frequency-monthly") || "Monthly"}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Once Mode */}
            {frequency === "once" && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Input
                            type="date"
                            title={t("triggers.date") || "Date"}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            min={getTodayString()}
                            state={errors.date ? "error" : "default"}
                            note={errors.date}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="font-bold text-sm">
                            {t("triggers.time") || "Time"} <span className="text-text-body">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            <Select value={hour} onValueChange={setHour}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="HH" />
                                </SelectTrigger>
                                <SelectContent>
                                    {hourOptions.map((h) => (
                                        <SelectItem key={h} value={h}>
                                            {h}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={minute} onValueChange={setMinute}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="MM" />
                                </SelectTrigger>
                                <SelectContent>
                                    {minuteOptions.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {errors.time && (
                            <p className="text-xs text-text-error">{errors.time}</p>
                        )}
                    </div>
                </div>
            )}

            {/* Daily Mode */}
            {frequency === "daily" && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className="font-bold text-sm">
                            {t("triggers.time") || "Time"} <span className="text-text-body">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            <Select value={hour} onValueChange={setHour}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="HH" />
                                </SelectTrigger>
                                <SelectContent>
                                    {hourOptions.map((h) => (
                                        <SelectItem key={h} value={h}>
                                            {h}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={minute} onValueChange={setMinute}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="MM" />
                                </SelectTrigger>
                                <SelectContent>
                                    {minuteOptions.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {errors.time && (
                            <p className="text-xs text-text-error">{errors.time}</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Input
                            type="date"
                            title={t("triggers.expiration-date") || "Expiration Date"}
                            value={expirationDate}
                            onChange={(e) => setExpirationDate(e.target.value)}
                            min={getTodayString()}
                            state={errors.expirationDate ? "error" : "default"}
                            note={errors.expirationDate}
                            optional
                        />
                    </div>
                </div>
            )}

            {/* Weekly Mode */}
            {frequency === "weekly" && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className="font-bold text-sm">
                            {t("triggers.time") || "Time"} <span className="text-text-body">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            <Select value={hour} onValueChange={setHour}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="HH" />
                                </SelectTrigger>
                                <SelectContent>
                                    {hourOptions.map((h) => (
                                        <SelectItem key={h} value={h}>
                                            {h}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={minute} onValueChange={setMinute}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="MM" />
                                </SelectTrigger>
                                <SelectContent>
                                    {minuteOptions.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {errors.time && (
                            <p className="text-xs text-text-error">{errors.time}</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label className="font-bold text-sm">
                            {t("triggers.select-weekdays") || "Select Weekdays"}
                        </Label>
                        <div className="grid grid-cols-7 gap-2">
                            {weekdays.map((day) => (
                                <button
                                    key={day.value}
                                    type="button"
                                    onClick={() => handleWeekdayToggle(day.value)}
                                    className={`
                                        px-2 py-2 rounded-md text-xs font-medium transition-colors
                                        ${
                                            selectedWeekdays.includes(day.value)
                                                ? "bg-brand-primary text-white"
                                                : "bg-surface-secondary text-text-body hover:bg-surface-primary"
                                        }
                                    `}
                                >
                                    {day.label.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                        {errors.weekdays && (
                            <p className="text-xs text-text-error">{errors.weekdays}</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Input
                            type="date"
                            title={t("triggers.expiration-date") || "Expiration Date"}
                            value={expirationDate}
                            onChange={(e) => setExpirationDate(e.target.value)}
                            min={getTodayString()}
                            state={errors.expirationDate ? "error" : "default"}
                            note={errors.expirationDate}
                            optional
                        />
                    </div>
                </div>
            )}

            {/* Monthly Mode */}
            {frequency === "monthly" && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Select value={monthDay} onValueChange={setMonthDay}>
                            <SelectTrigger
                                title={t("triggers.day-of-month") || "Day"}
                                state={errors.monthDay ? "error" : undefined}
                                note={errors.monthDay}
                                required
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                                    <SelectItem key={day} value={day.toString()}>
                                        {day}{getOrdinalSuffix(day)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-text-label">
                            {t("triggers.month-day-notice") || "Note: For months with fewer days (e.g., February, April), the task will be skipped if the selected day doesn't exist."}
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label className="font-bold text-sm">
                            {t("triggers.time") || "Time"} <span className="text-text-body">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                            <Select value={hour} onValueChange={setHour}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="HH" />
                                </SelectTrigger>
                                <SelectContent>
                                    {hourOptions.map((h) => (
                                        <SelectItem key={h} value={h}>
                                            {h}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={minute} onValueChange={setMinute}>
                                <SelectTrigger state={errors.time ? "error" : undefined}>
                                    <SelectValue placeholder="MM" />
                                </SelectTrigger>
                                <SelectContent>
                                    {minuteOptions.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {errors.time && (
                            <p className="text-xs text-text-error">{errors.time}</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Input
                            type="date"
                            title={t("triggers.expiration-date") || "Expiration Date"}
                            value={expirationDate}
                            onChange={(e) => setExpirationDate(e.target.value)}
                            min={getTodayString()}
                            state={errors.expirationDate ? "error" : "default"}
                            note={errors.expirationDate}
                            optional
                        />
                    </div>
                </div>
            )}

        </div>
    );
};
