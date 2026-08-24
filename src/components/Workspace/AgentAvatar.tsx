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

import browserAgentImage from '@/assets/agent/browser.png';
import camelAgentImage from '@/assets/agent/camel.png';
import catAgentImage from '@/assets/agent/cat.png';
import crabAgentImage from '@/assets/agent/crab.png';
import customAgentImage from '@/assets/agent/custom.png';
import documentAgentImage from '@/assets/agent/document.png';
import dogAgentImage from '@/assets/agent/dog.png';
import dragonAgentImage from '@/assets/agent/dragon.png';
import multiModalAgentImage from '@/assets/agent/multimodal.png';
import oasisAgentImage from '@/assets/agent/oasis.png';
import owlAgentImage from '@/assets/agent/owl.png';
import socialMediaAgentImage from '@/assets/agent/social.png';
import terminalAgentImage from '@/assets/agent/terminal.png';
import geminiImage from '@/assets/model/gemini.svg';
import { cn } from '@/lib/utils';

export type AgentAvatarKind =
  | 'single'
  | 'developer'
  | 'browser'
  | 'document'
  | 'multi-modal'
  | 'social-media'
  | 'subagent-crab'
  | 'subagent-dog'
  | 'subagent-dragon'
  | 'subagent-oasis'
  | 'subagent-owl'
  | 'subagent-cat'
  | 'gemini'
  | 'custom';

const DEFAULT_SUBAGENT_AVATARS: AgentAvatarKind[] = [
  'subagent-crab',
  'subagent-dog',
  'subagent-dragon',
  'subagent-oasis',
  'subagent-owl',
  'subagent-cat',
];

const AGENT_AVATAR_SOURCES: Record<AgentAvatarKind, string> = {
  single: camelAgentImage,
  developer: terminalAgentImage,
  browser: browserAgentImage,
  document: documentAgentImage,
  'multi-modal': multiModalAgentImage,
  'social-media': socialMediaAgentImage,
  'subagent-crab': crabAgentImage,
  'subagent-dog': dogAgentImage,
  'subagent-dragon': dragonAgentImage,
  'subagent-oasis': oasisAgentImage,
  'subagent-owl': owlAgentImage,
  'subagent-cat': catAgentImage,
  gemini: geminiImage,
  custom: customAgentImage,
};

const AGENT_AVATAR_SIZE_CLASS = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
} as const;

function normalizeAgentIdentity(value?: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function stableAvatarIndex(value: string): number {
  return [...value].reduce((total, character) => {
    return (total + character.charCodeAt(0)) % DEFAULT_SUBAGENT_AVATARS.length;
  }, 0);
}

/**
 * Resolves stable backend agent types first, then event-projected display names.
 * Unknown/custom workers intentionally share the generated general robot image.
 */
export function resolveAgentAvatarKind(
  agentType?: string,
  agentName?: string,
  provider?: string,
  model?: string,
  avatarSeed?: string
): AgentAvatarKind {
  const identities = [agentType, agentName].map(normalizeAgentIdentity);
  const hasIdentity = (...values: string[]) =>
    identities.some((identity) => values.includes(identity));

  if (hasIdentity('singleagent', 'camelagent')) return 'single';
  if (hasIdentity('developeragent', 'terminalagent')) return 'developer';
  if (hasIdentity('browseragent')) return 'browser';
  if (hasIdentity('documentagent')) return 'document';
  if (hasIdentity('multimodalagent')) return 'multi-modal';
  if (hasIdentity('socialmediaagent')) return 'social-media';
  if (normalizeAgentIdentity(agentType) === 'subagent') {
    const providerIdentity = normalizeAgentIdentity(`${provider} ${model}`);
    if (providerIdentity.includes('gemini')) return 'gemini';
    const seed = avatarSeed || agentName || agentType || 'subagent';
    return DEFAULT_SUBAGENT_AVATARS[stableAvatarIndex(seed)] ?? 'subagent-crab';
  }
  if (
    normalizeAgentIdentity(agentType) === 'agent' &&
    (!normalizeAgentIdentity(agentName) ||
      normalizeAgentIdentity(agentName) === 'agent')
  ) {
    return 'single';
  }
  return 'custom';
}

export function AgentAvatar({
  agentType,
  agentName,
  provider,
  model,
  avatarSeed,
  fullBleed = false,
  size = 'lg',
  className,
}: {
  agentType?: string;
  agentName?: string;
  provider?: string;
  model?: string;
  avatarSeed?: string;
  /** Fill a size-constrained avatar surface without the legacy icon inset. */
  fullBleed?: boolean;
  size?: keyof typeof AGENT_AVATAR_SIZE_CLASS;
  className?: string;
}) {
  const kind = resolveAgentAvatarKind(
    agentType,
    agentName,
    provider,
    model,
    avatarSeed
  );

  return (
    <img
      src={AGENT_AVATAR_SOURCES[kind]}
      alt=""
      aria-hidden
      data-agent-avatar={kind}
      className={cn(
        'block shrink-0',
        kind === 'gemini' ? 'object-contain' : 'object-cover',
        fullBleed ? 'size-full' : AGENT_AVATAR_SIZE_CLASS[size],
        className
      )}
    />
  );
}
