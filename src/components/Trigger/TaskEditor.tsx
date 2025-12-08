import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type TaskEditorProps = {
    value: string;
    onChange: (value: string) => void;
};

export const TaskEditor: React.FC<TaskEditorProps> = ({ value, onChange }) => {
    const { t } = useTranslation();
    const [isJsonMode, setIsJsonMode] = useState(false);
    const [jsonError, setJsonError] = useState<string | null>(null);

    // Validate JSON when in JSON mode
    useEffect(() => {
        if (isJsonMode && value) {
            try {
                JSON.parse(value);
                setJsonError(null);
            } catch (error) {
                setJsonError("Invalid JSON syntax");
            }
        } else {
            setJsonError(null);
        }
    }, [value, isJsonMode]);

    const handleModeToggle = (checked: boolean) => {
        if (checked) {
            // Switching to JSON mode - try to convert text to JSON
            try {
                const jsonValue = JSON.stringify({ task: value }, null, 2);
                onChange(jsonValue);
                setIsJsonMode(true);
            } catch (error) {
                toast.error("Failed to convert to JSON");
            }
        } else {
            // Switching to text mode - try to extract text from JSON
            try {
                const parsed = JSON.parse(value);
                const textValue = parsed.task || value;
                onChange(textValue);
                setIsJsonMode(false);
            } catch (error) {
                // If JSON is invalid, just keep the current value
                setIsJsonMode(false);
            }
        }
    };

    return (
        <div className="w-full space-y-2">
            <div className="flex items-center justify-between">
                <Label htmlFor="task">{t("triggers.trigger-task")}</Label>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-text-label">
                        {t("triggers.task-mode-text")}
                    </span>
                    <Switch
                        id="task-mode"
                        checked={isJsonMode}
                        onCheckedChange={handleModeToggle}
                    />
                    <span className="text-sm text-text-label">
                        {t("triggers.task-mode-json")}
                    </span>
                </div>
            </div>

            {isJsonMode ? (
                <div className="space-y-2">
                    <Textarea
                        id="task"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder='{"task": "Your task description here"}'
                        rows={8}
                        className="font-mono text-sm"
                    />
                    {jsonError && (
                        <p className="text-xs text-text-cuation">{jsonError}</p>
                    )}
                </div>
            ) : (
                <Textarea
                    id="task"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={t("triggers.task-prompt-placeholder")}
                    rows={5}
                />
            )}
        </div>
    );
};
