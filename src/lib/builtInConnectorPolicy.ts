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
 * Built-in connectors whose new-user flow is owned by Connector Gateway.
 *
 * Keep their local toolkit and stored config support for existing workers and
 * trigger credentials, but do not offer them as a second, misleading connected
 * source while the hosted Gateway runtime is active.
 */
const GATEWAY_OWNED_BUILT_INS = new Set(['slack']);

export function shouldExposeBuiltInConnector(
  key: string,
  connectorGatewayEnabled: boolean
): boolean {
  if (!connectorGatewayEnabled) return true;
  return !GATEWAY_OWNED_BUILT_INS.has(key.trim().toLowerCase());
}
