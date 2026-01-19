import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

type TriggerTaskInputProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    state?: "default" | "hover" | "input" | "error" | "success" | "disabled";
    note?: string;
};

export const TriggerTaskInput: React.FC<TriggerTaskInputProps> = ({
    value,
    onChange,
    placeholder,
    state = "default",
    note,
}) => {
    const { t } = useTranslation();

    return (
            <Textarea
                id="task"
                variant="enhanced"
                size="sm"
                required
                title={t("triggers.task-prompt")}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || t("triggers.task-prompt-placeholder")}
                className="flex-1 resize-none min-h-[100px]"
                state={state}
                note={note}
        />
    );
};

export default TriggerTaskInput;
