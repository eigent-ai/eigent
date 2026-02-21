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

import { Button } from '@/components/ui/button';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface ModelErrorCardProps {
  content: string;
  errorCode?: string | null;
}

export function ModelErrorCard({ content, errorCode }: ModelErrorCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const description = (() => {
    let text: string;
    switch (errorCode) {
      case 'invalid_api_key':
        text = t('chat.model-error-invalid-api-key');
        break;
      case 'model_not_found':
        text = t('chat.model-error-model-not-found');
        break;
      case 'insufficient_quota':
        text = t('chat.model-error-quota-exceeded');
        break;
      default:
        return content;
    }
    // The i18n strings end with " in" for the toast's inline link.
    // Strip it here since the card uses a separate button.
    return text.replace(/ in$/, '');
  })();

  return (
    <div className="flex w-full items-start gap-2 rounded-xl bg-surface-warning p-4">
      <TriangleAlert size={16} className="text-icon-warning" />
      <div className="flex flex-col items-start gap-2">
        <p className="mt-0 font-inter text-sm font-medium text-text-warning">
          {description}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => navigate('/setting/models')}
        >
          {t('chat.model-error-open-settings')}
        </Button>
      </div>
    </div>
  );
}
