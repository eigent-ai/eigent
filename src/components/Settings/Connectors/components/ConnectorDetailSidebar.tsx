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
  NavTab,
  SidebarBackHeader,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import { PlugZap, Plus, Search, Server, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorsNavigation } from '../ConnectorsNavigationContext';

export default function ConnectorDetailSidebar({
  selectedConnectorId,
  onBack,
  onAddConnector,
  onSelectConnector,
}: {
  selectedConnectorId?: string | null;
  onBack: () => void;
  onAddConnector: () => void;
  onSelectConnector: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { items, loading } = useConnectorsNavigation();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? items.filter((item) => item.name.toLowerCase().includes(normalized))
      : items;
  }, [items, query]);

  const leading = (item: (typeof items)[number]) => {
    const iconUrl =
      item.source === 'open'
        ? item.iconUrl
        : item.source === 'builtin' && item.builtInKey
          ? integrationLeadingIconUrl(item.builtInKey)
          : undefined;
    if (iconUrl) {
      return (
        <img src={iconUrl} alt="" className="h-4 w-4 shrink-0 object-contain" />
      );
    }
    const icon =
      item.source === 'open'
        ? PlugZap
        : item.source === 'builtin' || item.subtype === 'remote'
          ? Server
          : Wrench;
    return <DsIcon icon={icon} />;
  };

  return (
    <SidebarShell ariaLabel={t('connectors.title')} className="pt-0">
      <SidebarBackHeader
        onBack={onBack}
        action={
          <TooltipSimple
            content={t('connectors.add-connector')}
            variant="instant"
            side="bottom"
          >
            <Button
              type="button"
              variant="primary"
              size="sm"
              buttonRadius="full"
              buttonContent="icon-only"
              onClick={onAddConnector}
              aria-label={t('connectors.add-connector')}
            >
              <Plus aria-hidden />
            </Button>
          </TooltipSimple>
        }
      />
      <SidebarSection className="py-ds-8">
        <Input
          type="search"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          leadingIcon={<DsIcon icon={Search} />}
          aria-label={t('connectors.search-placeholder')}
          placeholder={t('connectors.search-placeholder')}
        />
      </SidebarSection>
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel={t('connectors.select-connector')}
          className="pt-ds-4"
        >
          <SidebarNavGroup>
            {loading && visible.length === 0
              ? Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    aria-hidden
                    className="h-8 animate-pulse rounded-ds-field bg-ds-neutral-subtle-default motion-reduce:animate-none"
                  />
                ))
              : null}
            {visible.map((item) => (
              <NavTab
                key={item.id}
                active={item.id === selectedConnectorId}
                onClick={() => onSelectConnector(item.id)}
                leading={leading(item)}
                label={item.name}
                tooltip={item.name}
                ariaLabel={item.name}
                ariaCurrentPage={item.id === selectedConnectorId}
              />
            ))}
            {!loading && visible.length === 0 ? (
              <DsText
                as="p"
                role="meta"
                className="px-ds-12 py-ds-16 text-center text-ds-ink-muted-default"
              >
                {t('connectors.no-matching')}
              </DsText>
            ) : null}
          </SidebarNavGroup>
        </SidebarScrollArea>
      </SidebarSection>
    </SidebarShell>
  );
}
