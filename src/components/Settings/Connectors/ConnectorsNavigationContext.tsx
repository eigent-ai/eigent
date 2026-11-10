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

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export type ConnectorNavigationItem = {
  id: string;
  name: string;
  source: 'open' | 'builtin' | 'custom';
  subtype?: 'local' | 'remote';
  active: boolean;
  iconUrl?: string;
  builtInKey?: string;
};

type ConnectorsNavigationContextValue = {
  items: ConnectorNavigationItem[];
  loading: boolean;
  publishItems: (items: ConnectorNavigationItem[], loading: boolean) => void;
};

const ConnectorsNavigationContext =
  createContext<ConnectorsNavigationContextValue | null>(null);

export function ConnectorsNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [items, setItems] = useState<ConnectorNavigationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const publishItems = useCallback(
    (nextItems: ConnectorNavigationItem[], nextLoading: boolean) => {
      setItems((current) => {
        if (
          current.length === nextItems.length &&
          current.every((item, index) => {
            const next = nextItems[index];
            return (
              item.id === next.id &&
              item.name === next.name &&
              item.source === next.source &&
              item.subtype === next.subtype &&
              item.active === next.active &&
              item.iconUrl === next.iconUrl &&
              item.builtInKey === next.builtInKey
            );
          })
        ) {
          return current;
        }
        return nextItems;
      });
      setLoading((current) =>
        current === nextLoading ? current : nextLoading
      );
    },
    []
  );
  const value = useMemo(
    () => ({ items, loading, publishItems }),
    [items, loading, publishItems]
  );
  return (
    <ConnectorsNavigationContext.Provider value={value}>
      {children}
    </ConnectorsNavigationContext.Provider>
  );
}

export function useConnectorsNavigation() {
  const context = useContext(ConnectorsNavigationContext);
  if (!context) {
    throw new Error(
      'useConnectorsNavigation must be used inside ConnectorsNavigationProvider'
    );
  }
  return context;
}

const ignoreConnectorNavigationItems = () => undefined;

/**
 * ConnectorGateway also has standalone consumers that do not render the
 * Settings sidebar. Publishing is optional for those consumers; the strict
 * reader above remains the contract for sidebar surfaces.
 */
export function usePublishConnectorsNavigation() {
  return (
    useContext(ConnectorsNavigationContext)?.publishItems ??
    ignoreConnectorNavigationItems
  );
}
