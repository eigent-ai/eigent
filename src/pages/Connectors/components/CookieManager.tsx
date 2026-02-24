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

import { fetchDelete, fetchGet } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Cookie, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface CookieDomain {
  domain: string;
  cookie_count: number;
  last_access: string;
}

export default function CookieManager() {
  const { t } = useTranslation();
  const [domains, setDomains] = useState<CookieDomain[]>([]);
  const [filteredDomains, setFilteredDomains] = useState<CookieDomain[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const loadCookies = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetchGet('/browser/cookies');

      if (response.success) {
        setDomains(response.domains || []);
        setFilteredDomains(response.domains || []);
      } else {
        toast.error(t('setting.failed-to-load-cookies'));
      }
    } catch (error) {
      console.error('Error loading cookies:', error);
      toast.error(t('setting.failed-to-load-cookies'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadCookies();
  }, [loadCookies]);

  useEffect(() => {
    if (searchQuery) {
      const filtered = domains.filter((domain) =>
        domain.domain.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredDomains(filtered);
    } else {
      setFilteredDomains(domains);
    }
  }, [searchQuery, domains]);

  const handleDeleteDomain = async (domain: string) => {
    try {
      setIsDeleting(domain);
      const response = await fetchDelete(`/browser/cookies/${domain}`);

      if (response.success) {
        toast.success(t('setting.cookies-deleted-successfully', { domain }));
        // Reload the list
        await loadCookies();
      } else {
        toast.error(t('setting.failed-to-delete-cookies'));
      }
    } catch (error) {
      console.error('Error deleting cookies:', error);
      toast.error(t('setting.failed-to-delete-cookies'));
    } finally {
      setIsDeleting(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(t('setting.confirm-delete-all-cookies'))) {
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetchDelete('/browser/cookies');

      if (response.success) {
        toast.success(t('setting.all-cookies-deleted'));
        setDomains([]);
        setFilteredDomains([]);
      } else {
        toast.error(t('setting.failed-to-delete-cookies'));
      }
    } catch (error) {
      console.error('Error deleting all cookies:', error);
      toast.error(t('setting.failed-to-delete-cookies'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-surface-secondary px-6 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="gap-2 text-base font-bold leading-12 text-text-primary flex items-center">
            <Cookie className="h-5 w-5" />
            {t('setting.cookie-manager')}
          </div>
          <div className="mt-1 text-sm leading-13 text-text-secondary">
            {t('setting.cookie-manager-description')}
          </div>
        </div>
        <div className="gap-2 flex">
          <Button
            onClick={loadCookies}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
            {t('setting.refresh')}
          </Button>
          {domains.length > 0 && (
            <Button
              onClick={handleDeleteAll}
              variant="outline"
              size="sm"
              disabled={isLoading}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              {t('setting.delete-all')}
            </Button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4 relative">
        <Search className="left-3 h-4 w-4 text-text-tertiary absolute top-1/2 -translate-y-1/2 transform" />
        <Input
          type="text"
          placeholder={t('setting.search-domains')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Cookie List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-text-secondary text-center">
            <RefreshCw className="mb-2 h-6 w-6 animate-spin mx-auto" />
            {t('setting.loading-cookies')}
          </div>
        ) : filteredDomains.length === 0 ? (
          <div className="py-8 text-text-secondary text-center">
            <Cookie className="mb-3 h-12 w-12 mx-auto opacity-30" />
            <div className="mb-1 text-base font-medium">
              {domains.length === 0
                ? t('setting.no-cookies-found')
                : t('setting.no-matching-domains')}
            </div>
            {domains.length === 0 && (
              <div className="text-sm">
                {t('setting.login-to-save-cookies')}
              </div>
            )}
          </div>
        ) : (
          filteredDomains.map((item) => (
            <div
              key={item.domain}
              className="rounded-lg border-border-primary bg-surface-primary p-3 hover:border-border-secondary flex items-center justify-between border transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text-primary truncate">
                  {item.domain}
                </div>
                <div className="mt-1 gap-3 text-xs text-text-tertiary flex items-center">
                  <span>
                    {t('setting.cookies-count', { count: item.cookie_count })}
                  </span>
                  <span>
                    {t('setting.last-access')}: {item.last_access}
                  </span>
                </div>
              </div>
              <Button
                onClick={() => handleDeleteDomain(item.domain)}
                variant="outline"
                size="xs"
                disabled={isDeleting === item.domain}
                className="ml-3 text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" />
                {isDeleting === item.domain
                  ? t('setting.deleting')
                  : t('setting.delete')}
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Warning */}
      {domains.length > 0 && (
        <div className="dark:bg-yellow-900/20 mt-4 rounded-lg border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 border">
          <div className="gap-2 flex items-start">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            <div className="text-xs text-yellow-800 dark:text-yellow-200">
              {t('setting.cookie-delete-warning')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
