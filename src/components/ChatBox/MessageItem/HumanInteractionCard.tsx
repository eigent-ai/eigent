import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  decideHumanInteraction,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';
import { useAuthStore } from '@/store/authStore';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

interface HumanInteractionCardProps {
  interaction: HumanInteractionPayload;
  readOnly?: boolean;
  onResolved?: () => void;
}

const requestId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function HumanInteractionCard({
  interaction,
  readOnly = false,
  onResolved,
}: HumanInteractionCardProps) {
  const userId = useAuthStore((state) => state.user_id);
  const decisionRequestId = useRef(requestId());
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  useEffect(() => {
    decisionRequestId.current = requestId();
    setSubmitting(false);
    setResolved(false);
    setFormValues({});
  }, [interaction.interaction_id]);
  const targets = useMemo(
    () => interaction.target_resources?.filter(Boolean) || [],
    [interaction.target_resources]
  );

  const submit = async (decision: Record<string, unknown>) => {
    if (readOnly || resolved || submitting) return;
    setSubmitting(true);
    try {
      await decideHumanInteraction(interaction, {
        decisionRequestId: decisionRequestId.current,
        decision,
        actorId: userId,
      });
      setResolved(true);
      onResolved?.();
    } catch (error) {
      console.error('[HumanInteractionCard] decision failed', error);
      toast.error('Could not save your decision. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = readOnly || resolved || submitting;
  const title =
    interaction.title ||
    (interaction.interaction_type === 'approval'
      ? 'Approval required'
      : 'Input required');

  return (
    <div className="mx-6 my-3 rounded-2xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-warning-default-default" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-semibold text-ds-text-neutral-default-default">
              {title}
            </div>
            {interaction.question ? (
              <p className="mt-1 text-sm text-ds-text-neutral-subtle-default">
                {interaction.question}
              </p>
            ) : null}
          </div>

          {interaction.operation ? (
            <div className="rounded-xl bg-ds-bg-neutral-default-default px-3 py-2 text-xs text-ds-text-neutral-subtle-default">
              <div>{interaction.operation}</div>
              {targets.slice(0, 3).map((target) => (
                <div key={target} className="truncate font-mono" title={target}>
                  {target}
                </div>
              ))}
            </div>
          ) : null}

          {interaction.rule_matcher?.resource_pattern ? (
            <div className="rounded-xl border border-ds-border-warning-subtle-default px-3 py-2 text-xs text-ds-text-neutral-subtle-default">
              <div className="font-medium">Persistent approval matcher</div>
              <div
                className="mt-1 font-mono"
                title={interaction.rule_matcher.resource_pattern}
              >
                {interaction.rule_matcher.action_pattern}{' '}
                {interaction.rule_matcher.resource_pattern}
              </div>
            </div>
          ) : null}

          {interaction.interaction_type === 'form' ? (
            <div className="space-y-2">
              {(interaction.fields || []).map((field) => (
                <label key={field.id} className="block text-xs">
                  <span>{field.label}</span>
                  <Input
                    className="mt-1"
                    type={field.type || 'text'}
                    required={field.required}
                    value={formValues[field.id] || ''}
                    onChange={(event) =>
                      setFormValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                    disabled={disabled}
                  />
                </label>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {interaction.interaction_type === 'approval' ? (
              <>
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    void submit({ decision: 'approved', scope: 'once' })
                  }
                >
                  Approve once
                </Button>
                {(interaction.allowed_scopes || []).includes('run') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'approved', scope: 'run' })
                    }
                  >
                    Allow for this Run
                  </Button>
                ) : null}
                {(interaction.allowed_scopes || []).includes('space') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void submit({ decision: 'approved', scope: 'space' })
                    }
                  >
                    Always allow in Space
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    void submit({ decision: 'rejected', scope: 'once' })
                  }
                >
                  Reject
                </Button>
              </>
            ) : interaction.interaction_type === 'choice' ? (
              (interaction.options || []).map((option) => (
                <Button
                  key={option.option_id || option.id || option.label}
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void submit({
                      option_id: option.option_id || option.id,
                      value: option.value,
                    })
                  }
                >
                  {option.label}
                </Button>
              ))
            ) : interaction.interaction_type === 'form' ? (
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => void submit({ values: formValues })}
              >
                Submit
              </Button>
            ) : interaction.interaction_type !== 'question' ? (
              <>
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => void submit({ decision: 'approved' })}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void submit({ decision: 'rejected' })}
                >
                  Reject
                </Button>
              </>
            ) : null}
          </div>
          {resolved ? (
            <div className="text-xs text-ds-text-success-default-default">
              Decision saved
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
