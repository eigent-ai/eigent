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

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { parseSpaceModelReference } from '@/lib/spaceModelReference';
import { discoverSpaceModels } from '@/service/spaceModelDiscovery';
import type {
  WorkspaceBundleReferenceFinding,
  WorkspaceConfigurationDocument,
} from '@/service/workspaceConfigurationApi';
import { getAuthStore } from '@/store/authStore';

type Finding = WorkspaceBundleReferenceFinding;
const unavailable = (): Finding => ({
  location: 'spec',
  reference: '',
  code: 'verification_unavailable',
});

export const blocksLocalBundlePublish = (finding: Finding): boolean =>
  ['malformed', 'unsupported', 'verification_unavailable'].includes(
    finding.code
  );

/** Device preflight only. This cannot attest Cloud ACLs or recipient setup. */
export async function preflightWorkspaceBundleReferences(
  document: WorkspaceConfigurationDocument,
  deviceFindings: Finding[] | undefined
): Promise<Finding[]> {
  const auth = getAuthStore();
  const account = getAccountEnvironmentKey(auth);
  const token = auth.token;
  const findings = deviceFindings ? [...deviceFindings] : [unavailable()];
  const modelReferences: Array<{ location: string; reference: string }> = [];
  for (const [name, model] of Object.entries(document.spec.models)) {
    const reference = model.modelRef;
    const location = `spec.models.${name}.modelRef`;
    if (reference === 'provider://default') continue; // Recipient's default.
    if (!parseSpaceModelReference(reference)) {
      const knownCategory = /^provider:\/\/(?:cloud|custom|local)(?:\/|$)/.test(
        reference
      );
      findings.push({
        location,
        reference,
        code:
          knownCategory || reference === 'provider://'
            ? 'malformed'
            : 'unsupported',
      });
    } else {
      modelReferences.push({ location, reference });
    }
  }
  if (modelReferences.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Discovery bypasses stale catalogs and rejects account switches. A
      // bounded UI wait never turns a partial/timed-out catalog into absence.
      const catalog = await Promise.race([
        discoverSpaceModels({ requireComplete: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('catalog_timeout')),
            10_000
          );
        }),
      ]);
      for (const item of modelReferences) {
        const source = item.reference.startsWith('provider://cloud/')
          ? 'cloud_catalog'
          : 'provider_catalog';
        if (catalog.unavailableSources.includes(source)) {
          findings.push({ ...item, code: 'verification_unavailable' });
          continue;
        }
        const candidate = catalog.items.find(
          ({ value }) => value === item.reference
        );
        if (candidate?.reason === 'model_ambiguous') {
          findings.push({ ...item, code: 'verification_unavailable' });
        } else if (
          !candidate ||
          candidate.disabled ||
          candidate.availability !== 'available'
        ) {
          findings.push({ ...item, code: 'model_setup_required' });
        }
      }
    } catch {
      findings.push(
        ...modelReferences.map((item): Finding => ({
          ...item,
          code: 'verification_unavailable',
        }))
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const current = getAuthStore();
  if (
    account !== getAccountEnvironmentKey(current) ||
    token !== current.token
  ) {
    return [unavailable()];
  }
  return findings;
}

/** Missing here means not included in this save, never absent from a registry. */
export function bundleAssetReferenceFindings(
  document: WorkspaceConfigurationDocument,
  includedAssets: Set<string>
): Finding[] {
  const references = [
    ...Object.entries(document.spec.instructions).map(([name, reference]) => ({
      location: `spec.instructions.${name}`,
      reference,
      skill: false,
    })),
    ...document.spec.context.flatMap((item, index) =>
      item.kind === 'bundle_asset' && item.path
        ? [
            {
              location: `spec.context[${index}].path`,
              reference: item.path,
              skill: false,
            },
          ]
        : []
    ),
    ...document.spec.skills.map((item, index) => ({
      location: `spec.skills[${index}].ref`,
      reference: item.ref,
      skill: true,
    })),
    ...document.spec.mcpServers.map((item, index) => ({
      location: `spec.mcpServers[${index}].definition`,
      reference: item.definition,
      skill: false,
    })),
  ];
  return references.flatMap(({ location, reference, skill }): Finding[] => {
    if (!reference.startsWith('bundle://')) return [];
    const path = reference.slice('bundle://'.length);
    const code =
      /[\\%?#\u0000-\u001f]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
        ? 'malformed'
        : skill && !path.endsWith('/SKILL.md') && path !== 'SKILL.md'
          ? 'unsupported'
          : !includedAssets.has(path)
            ? 'bundle_asset_required'
            : null;
    return code ? [{ location, reference, code }] : [];
  });
}
