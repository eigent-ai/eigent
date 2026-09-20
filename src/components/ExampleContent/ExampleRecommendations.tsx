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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Skeleton } from '@/components/ui/skeleton';
import { isExampleContentEnabled } from '@/lib/exampleContentFeature';
import { cn } from '@/lib/utils';
import type { ExampleContentItem } from '@/types/exampleContent';
import { Sparkles } from 'lucide-react';
import { useId } from 'react';

export type ExampleRecommendationsState =
  'loading' | 'ready' | 'empty' | 'disabled' | 'unavailable';

export interface ExampleRecommendationsMessages {
  heading: string;
  chooseExample: string;
  empty: string;
  disabled: string;
  unavailable: string;
}

export interface ExampleRecommendationsProps {
  state: ExampleRecommendationsState;
  items: ExampleContentItem[];
  messages: ExampleRecommendationsMessages;
  onSelect: (item: ExampleContentItem) => void;
  className?: string;
}

const StatusMessage = ({ children }: { children: string }) => (
  <DsText role="base" className="text-ds-ink-muted-default">
    {children}
  </DsText>
);

export function ExampleRecommendations({
  state,
  items,
  messages,
  onSelect,
  className,
}: ExampleRecommendationsProps) {
  const headingId = useId();
  const effectiveState =
    state === 'ready' && items.length === 0 ? 'empty' : state;

  if (!isExampleContentEnabled()) return null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={effectiveState === 'loading'}
      className={cn('flex flex-col gap-ds-stack-related', className)}
    >
      <div className="gap-ds-stack-tight flex items-center text-ds-ink-default-default">
        <DsIcon icon={Sparkles} recipe="main" />
        <DsText id={headingId} role="title" weight="semibold">
          {messages.heading}
        </DsText>
      </div>

      {effectiveState === 'loading' ? (
        <div
          className="grid gap-ds-stack-related sm:grid-cols-3"
          aria-hidden="true"
        >
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-ds-control-sm w-2/3" />
                <Skeleton className="h-ds-control-sm w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-ds-control-md w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : effectiveState === 'ready' ? (
        <div className="grid gap-ds-stack-related sm:grid-cols-3">
          {items.map((item) => (
            <Card key={item.exampleRef} className="flex min-w-0 flex-col">
              <CardHeader className="min-w-0">
                <DsText
                  role="title"
                  weight="semibold"
                  className="text-ds-ink-default-default"
                >
                  {item.title}
                </DsText>
              </CardHeader>
              <CardContent className="min-w-0 flex-1">
                <DsText role="base" className="text-ds-ink-muted-default">
                  {item.summary}
                </DsText>
              </CardContent>
              <CardFooter>
                <Button
                  type="button"
                  variant="secondary"
                  tone="neutral"
                  size="sm"
                  onClick={() => onSelect(item)}
                  aria-label={`${messages.chooseExample}: ${item.title}`}
                >
                  {messages.chooseExample}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : effectiveState === 'empty' ? (
        <StatusMessage>{messages.empty}</StatusMessage>
      ) : effectiveState === 'disabled' ? (
        <StatusMessage>{messages.disabled}</StatusMessage>
      ) : (
        <StatusMessage>{messages.unavailable}</StatusMessage>
      )}
    </section>
  );
}
