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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/store/authStore';
import {
  fetchBillingSummary,
  fetchCurrentUser,
  updateUserProfile,
} from '@web/api/server';
import { ThemeSettings } from '@web/components/profile/ThemeSettings';
import { useLogout } from '@web/hooks/useWebAuth';
import { normalizeBillingSummary } from '@web/lib/viewModels';
import type { BillingSummary, UserProfile } from '@web/types';
import { useEffect, useState } from 'react';

export default function ProfilePage() {
  const email = useAuthStore((state) => state.email);
  const logout = useLogout();
  const [profile, setProfile] = useState<UserProfile>({
    fullname: '',
    nickname: '',
    work_desc: '',
  });
  const [billing, setBilling] = useState<BillingSummary>(
    normalizeBillingSummary(null, email ?? undefined)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [user, summary] = await Promise.all([
          fetchCurrentUser(),
          fetchBillingSummary().catch(() => null),
        ]);
        setProfile({
          fullname: user.fullname ?? '',
          nickname: user.nickname ?? '',
          work_desc: user.work_desc ?? '',
        });
        setBilling(
          normalizeBillingSummary(summary, user.email ?? email ?? undefined)
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [email]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateUserProfile(profile);
      setMessage('Profile saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gap-6 flex h-full w-full flex-col overflow-y-auto">
      <div className="gap-3 flex flex-wrap items-center justify-between">
        <div>
          <h1 className="text-heading-md font-semibold text-ds-text-neutral-default-default">
            Profile & settings
          </h1>
          <p className="text-body-md text-ds-text-neutral-muted-default">
            Manage your account, credits, and appearance.
          </p>
        </div>
        <Button variant="outline" onClick={logout}>
          Sign out
        </Button>
      </div>

      <div className="gap-6 lg:grid-cols-2 grid">
        <section className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 border">
          <h2 className="mb-4 text-heading-sm font-semibold">
            Personalization
          </h2>
          {loading ? (
            <p className="text-body-sm text-ds-text-neutral-muted-default">
              Loading…
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 text-body-sm font-medium block">
                  Email
                </label>
                <Input value={billing.email || email || ''} disabled />
              </div>
              <div>
                <label className="mb-1 text-body-sm font-medium block">
                  Full name
                </label>
                <Input
                  value={profile.fullname}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      fullname: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 text-body-sm font-medium block">
                  Nickname
                </label>
                <Input
                  value={profile.nickname}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      nickname: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 text-body-sm font-medium block">
                  Work description
                </label>
                <Textarea
                  value={profile.work_desc}
                  onChange={(event) =>
                    setProfile((prev) => ({
                      ...prev,
                      work_desc: event.target.value,
                    }))
                  }
                  rows={3}
                />
              </div>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
              {message ? (
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  {message}
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 border">
          <h2 className="mb-4 text-heading-sm font-semibold">
            Subscription & credits
          </h2>
          <dl className="gap-3 text-body-sm grid grid-cols-2">
            <div>
              <dt className="text-ds-text-neutral-muted-default">Plan</dt>
              <dd className="font-medium text-ds-text-neutral-default-default">
                {billing.plan_name}
              </dd>
            </div>
            <div>
              <dt className="text-ds-text-neutral-muted-default">Mode</dt>
              <dd className="font-medium text-ds-text-neutral-default-default capitalize">
                {billing.subscription_mode}
              </dd>
            </div>
            <div>
              <dt className="text-ds-text-neutral-muted-default">
                Total credits
              </dt>
              <dd className="font-medium text-ds-text-neutral-default-default">
                {billing.credits_total.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-ds-text-neutral-muted-default">Daily</dt>
              <dd className="font-medium text-ds-text-neutral-default-default">
                {billing.credits_daily.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-ds-text-neutral-muted-default">Monthly</dt>
              <dd className="font-medium text-ds-text-neutral-default-default">
                {billing.credits_monthly.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-ds-text-neutral-muted-default">Permanent</dt>
              <dd className="font-medium text-ds-text-neutral-default-default">
                {billing.credits_permanent.toLocaleString()}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <ThemeSettings />
    </div>
  );
}
