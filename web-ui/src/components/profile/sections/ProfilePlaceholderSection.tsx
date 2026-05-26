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

export function ProfilePlaceholderSection({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-6 mx-auto w-full max-w-[640px] border border-dashed text-center">
      <h2 className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
        {title}
      </h2>
      <p className="mt-2 text-body-sm text-ds-text-neutral-muted-default">
        {description ??
          `${title} settings are not available in Dispatch web yet.`}
      </p>
    </div>
  );
}
