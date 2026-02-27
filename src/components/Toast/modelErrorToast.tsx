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

import i18n from '@/i18n';
import { toast } from 'sonner';

export function showModelErrorToast(
  errorMessage: string,
  errorCode?: string | null
) {
  toast.dismiss();

  let description: string;
  if (errorCode === 'invalid_api_key') {
    description = i18n.t('chat.model-error-invalid-api-key');
  } else if (errorCode === 'model_not_found') {
    description = i18n.t('chat.model-error-model-not-found');
  } else if (errorCode === 'insufficient_quota') {
    description = i18n.t('chat.model-error-quota-exceeded');
  } else {
    description = errorMessage;
  }

  const isPersistent = errorCode === 'invalid_api_key';

  toast.error(
    <div>
      {description}{' '}
      <a
        className="cursor-pointer underline"
        onClick={() => (window.location.href = '#/setting/models')}
      >
        {i18n.t('chat.model-error-go-to-settings')}
      </a>
    </div>,
    {
      duration: isPersistent ? Infinity : 8000,
      closeButton: true,
    }
  );
}
