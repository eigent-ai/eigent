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

/**
 * Placeholder rows sized to a short and a long message so the container keeps
 * its height when the real conversation replaces them.
 */
export function ChatTimelineSkeleton({ label }: { label: string }) {
  return (
    <div
      aria-busy
      aria-label={label}
      className="flex w-full flex-col gap-3"
      data-chat-timeline-skeleton
      role="status"
    >
      {[
        ['w-2/5', 'h-16'],
        ['w-full', 'h-24'],
        ['w-1/3', 'h-16'],
      ].map(([width, height], index) => (
        <div
          key={`chat-skeleton-${index}`}
          className={`${height} ${index % 2 === 0 ? 'ml-auto' : ''} ${width} animate-pulse rounded-xl bg-ds-neutral-strong-default`}
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
