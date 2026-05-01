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
// Host context: inject desktop or web capabilities. Components use useHost(),
// never direct global Electron APIs.

import React, { createContext, useContext, useMemo } from 'react';
import type { AppHost } from './types';

const HostContext = createContext<AppHost | null>(null);

export function HostProvider({
  host,
  children,
}: {
  host: AppHost;
  children: React.ReactNode;
}) {
  const value = useMemo(() => host, [host]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHost(): AppHost | null {
  return useContext(HostContext);
}
