import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

type TriggerTaskInputProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
};

export const TriggerTaskInput: React.FC<TriggerTaskInputProps> = ({
    value,
    onChange,
    placeholder,
}) => {
    const { t } = useTranslation();

    return (
        <div className="w-full flex flex-col gap-2">
            {/* Header */}
            <Label htmlFor="task" className="text-sm font-bold text-text-heading">
                {t("triggers.trigger-task")}
            </Label>

            {/* Task input area */}
            <Textarea
                id="task"
                variant="enhanced"
                size="sm"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || t("triggers.task-prompt-placeholder")}
                className="flex-1 resize-none min-h-[100px]"
            />
        </div>
    );
};

export default TriggerTaskInput;
