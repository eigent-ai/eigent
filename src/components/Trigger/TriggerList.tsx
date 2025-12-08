import React from "react";
import { Trigger } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TriggerCard } from "@/components/Trigger/TriggerCard";
import { Plus, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ListenerType, TriggerStatus, TriggerType } from "@/types";

type TriggerListProps = {
  triggers: Trigger[];
  pendingTrigger: Trigger | null;
  selectedTriggerId: number | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onAddTrigger: () => void;
  onSelectTrigger: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};

export const TriggerList: React.FC<TriggerListProps> = ({
  triggers,
  pendingTrigger,
  selectedTriggerId,
  searchQuery,
  onSearchChange,
  onAddTrigger,
  onSelectTrigger,
  onToggleActive,
}) => {
  const { t } = useTranslation();

  // local filtered list respecting the search term
  const filteredTriggers = React.useMemo(
    () =>
      triggers.filter(
        (trigger) =>
          trigger.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (trigger.description &&
            trigger.description.toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [triggers, searchQuery]
  );

  const handleAddTrigger = () => {
    onAddTrigger();
  };

  return (
    <div className="flex-[0.3] flex flex-col h-full border-solid border-y-0 border-l-0 border-r-[0.5px] border-border-secondary bg-surface-primary">
      <div className="flex flex-row items-center justify-between px-sm py-sm">
        <div className="text-text-body font-bold text-body-base leading-relaxed">
          {t("layout.triggers")}
        </div>

        <Button
          size="icon"
          onClick={handleAddTrigger}
          variant="primary"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 h-full px-sm pb-sm">

        {filteredTriggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-lg gap-sm">
            <Activity className="w-8 h-8 text-icon-secondary mx-auto" />
            <p className="text-text-label text-sm">
              {searchQuery ? "No triggers found" : t("triggers.no-triggers")}
            </p>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col overflow-auto scrollbar pt-xs gap-sm">
            {pendingTrigger && (
              <TriggerCard
                key={`pending-${pendingTrigger.id}`}
                trigger={pendingTrigger}
                onSelect={onSelectTrigger}
                onToggleActive={onToggleActive}
                selected={selectedTriggerId === pendingTrigger.id}
              />
            )}
            {filteredTriggers.map((trigger) => (
              <TriggerCard
                key={trigger.id}
                trigger={trigger}
                onSelect={onSelectTrigger}
                onToggleActive={onToggleActive}
                selected={selectedTriggerId === trigger.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};



