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
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';

export function MessageComposer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (message: string) => void | Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 border">
      <label className="mb-2 text-body-sm font-medium text-ds-text-neutral-default-default block">
        Send instruction
      </label>
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Describe what you want this project to do…"
        rows={4}
        disabled={disabled || sending}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void handleSubmit();
          }
        }}
      />
      {error ? (
        <p className="mt-2 text-body-sm text-ds-text-error-default-default">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button
          onClick={() => void handleSubmit()}
          disabled={disabled || sending || !message.trim()}
        >
          {sending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}
