// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import { parseAutomationDraft } from '@/lib/automationDraft';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSkillsStore } from '@/store/skillsStore';
import { AlarmClock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface CreateAutomationFromTaskProps {
  projectId: string;
  taskPrompt: string;
  resultContent: string;
}

export function CreateAutomationFromTask({
  projectId,
  taskPrompt,
  resultContent,
}: CreateAutomationFromTaskProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const draft = useMemo(
    () => parseAutomationDraft(resultContent),
    [resultContent]
  );
  const requestChatDraft = usePageTabStore(
    (state) => state.requestWorkspaceChatDraft
  );
  const activeProjectId = usePageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const skillAvailable = useSkillsStore((state) =>
    state.skills.some(
      (skill) =>
        skill.enabled &&
        (skill.name === 'automation-draft' ||
          skill.skillDirName === 'automation-draft')
    )
  );

  const prepareSkillDraft = () => {
    if (activeProjectId !== projectId) return;
    if (!skillAvailable) {
      toast.info(t('chat.automation-skill-unavailable'));
      return;
    }
    const prompt = [
      '#automation-draft',
      'Use the automation-draft skill to propose an editable automation for this completed Task. Do not create it. Return the versioned automation-draft block.',
      `Original request:\n${taskPrompt.slice(0, 4000)}`,
      `Final result summary:\n${resultContent.slice(0, 4000)}`,
    ].join('\n\n');
    requestChatDraft(prompt, undefined, { projectId, ifEmpty: true });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {skillAvailable && !draft && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={prepareSkillDraft}
            disabled={activeProjectId !== projectId}
          >
            {t('chat.automation-draft-with-skill')}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
        >
          <AlarmClock aria-hidden />
          {t('chat.create-automation-from-task', {
            defaultValue: 'Create automation',
          })}
        </Button>
      </div>
      <TriggerDialog
        selectedTrigger={null}
        isOpen={open}
        onOpenChange={setOpen}
        sourceProjectId={projectId}
        initialTaskPrompt={taskPrompt}
        initialDraft={draft}
      />
    </>
  );
}
