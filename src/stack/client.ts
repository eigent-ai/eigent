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

import { StackClientApp } from "@stackframe/react";
import { useNavigate } from "react-router-dom";
import { hasStackKeys } from "../lib";

const hasSlackKeys = hasStackKeys();

export const stackClientApp = hasSlackKeys ? new StackClientApp({
	projectId: import.meta.env.VITE_STACK_PROJECT_ID,
	publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
	tokenStore: "cookie",
	redirectMethod: {
		useNavigate,
	},
	urls: {
		oauthCallback: (import.meta.env.DEV ? import.meta.env.VITE_PROXY_URL : import.meta.env.VITE_BASE_URL) + "/api/redirect/callback",
	},
}) : null;
