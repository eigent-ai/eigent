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

import ellipseIcon from '@/assets/mcp/Ellipse-25.svg';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';

/**
 * Logos for connector tags in chat text (`@Slack` shows as the Slack logo and
 * "Slack"). Hosted connectors carry their logo URL from the API, so the
 * composer's connector list records each one here when it loads; built-in
 * integrations resolve from the bundled logos by name.
 */
const rememberedIconUrls = new Map<string, string>();

/** Records the logo for a `@connector` token once the API reports it. */
export function rememberConnectorChipIcon(token: string, iconUrl: string) {
  rememberedIconUrls.set(token, iconUrl);
}

/** Logo URL for a `@connector` token; a neutral dot when none is known. */
export function connectorChipIconUrl(token: string): string {
  const remembered = rememberedIconUrls.get(token);
  if (remembered) return remembered;
  const name = token.replace(/^@/, '').replace(/_/g, ' ');
  return integrationLeadingIconUrl(name) ?? ellipseIcon;
}

/** The connector's display name inside its tag: the token without `@`. */
export function connectorChipLabel(token: string): string {
  return token.replace(/^@/, '');
}

/** Logo geometry inside an inline 13px / 20px tag. */
export const CONNECTOR_CHIP_ICON_CLASSES =
  'mr-1 inline-block h-3.5 w-3.5 object-contain align-text-bottom';
