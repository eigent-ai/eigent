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
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const COPIED_RESET_MS = 2000;

interface FeedbackCardProps {
  id: string;
  title: string;
  content: string;
  onConfirm?: () => void;
  onSkip?: () => void;
  className?: string;
}

export function FeedbackCard({
  id,
  title,
  content,
  onConfirm,
  onSkip,
  className,
}: FeedbackCardProps) {
  const [_isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const { t } = useTranslation();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t('setting.copied-to-clipboard'));
      setCopied(true);
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, COPIED_RESET_MS);
    } catch {
      toast.error(t('setting.failed-to-copy-to-clipboard'));
    }
  }, [content, t]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      key={id}
      className={`bg-message-fill-secondary group relative flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border px-4 py-3 ${className || ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Copy button - appears on hover */}
      <div className="absolute bottom-1 right-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <Button onClick={handleCopy} variant="ghost" size="icon">
          {copied ? (
            <Check className="h-4 w-4 text-text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Title */}
      <p className="w-full font-inter text-sm font-bold leading-normal text-text-body">
        {title}
      </p>

      {/* Content */}
      <p className="w-full font-inter text-sm font-medium leading-normal text-text-body">
        {content}
      </p>

      {/* Action buttons */}
      <div className="flex w-full items-center gap-1">
        <Button
          onClick={onConfirm}
          variant="primary"
          size="xs"
          className="flex-1"
        >
          Answer Agent
        </Button>
        <Button onClick={onSkip} variant="ghost" size="xs" className="flex-1">
          Skip
        </Button>
      </div>
    </div>
  );
}
