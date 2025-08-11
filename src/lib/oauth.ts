const EnvOauthInfoMap = {
	notion: "NOTION_TOKEN",
};

export class OAuth {
	public client_name: string = 'Eigent';
	public client_uri: string = 'https://eigent.ai/';
	public redirect_uris: string[] = [];

	public url: string = '';
	public authServerUrl: string = '';
	public resourcePath: string = '/.well-known/oauth-protected-resource';
	public authorizationServerPath: string = '/.well-known/oauth-authorization-server';
	public resourceMetadata: any;
	public authorizationServerMetadata: any;
	public registerClientData: any;
	public codeVerifier: string = '';
	public provider: string = '';

	constructor(mcpName?: string) {
		if (mcpName) {
			this.startOauth(mcpName);
		}
	}

	async startOauth(mcpName: string) {
		const mcp = mcpMap[mcpName as keyof typeof mcpMap];
		if (!mcp) throw new Error(`MCP ${mcpName} not found`);

		this.url = mcp.url;
		this.provider = mcp.provider;
		this.redirect_uris = [`https://dev.eigent.ai/api/oauth/${this.provider}/callback`];
		this.authServerUrl = new URL(mcp.url).origin;
		this.resourcePath = mcp?.resourcePath || this.resourcePath;
		this.authorizationServerPath = mcp?.authorizationServerPath || this.authorizationServerPath;

		this.resourceMetadata = await this.getResourceMetadata();
		this.authorizationServerMetadata = await this.getAuthorizationServerMetadata();
		this.registerClientData = await this.clientRegistration();
		const oauthUrl = await this.generateAuthUrl();
		window.location.href = oauthUrl;
	}

	async getResourceMetadata() {
		return await fetch(this.authServerUrl + this.resourcePath).then(res => res.json());
	}

	async getAuthorizationServerMetadata() {
		return await fetch(this.authServerUrl + this.authorizationServerPath).then(res => res.json());
	}

	async clientRegistration() {
		const { registration_endpoint, grant_types_supported, response_types_supported } = this.authorizationServerMetadata;
		return await fetch(registration_endpoint, {
			method: 'POST',
			body: JSON.stringify({
				client_name: this.client_name,
				client_uri: this.client_uri,
				redirect_uris: this.redirect_uris,
				grant_types: grant_types_supported,
				response_types: response_types_supported,
				token_endpoint_auth_method: 'none'
			}),
		}).then(res => res.json());
	}

	async generateAuthUrl() {
		const responseType = "code";
		const codeChallengeMethod = "S256";
		const { authorization_endpoint } = this.authorizationServerMetadata;
		const { code_challenge, code_verifier } = await this.pkceChallenge();
		this.codeVerifier = code_verifier;
		return `${authorization_endpoint}?response_type=${responseType}&client_id=${this.registerClientData.client_id}&redirect_uri=${this.redirect_uris[0]}&code_challenge_method=${codeChallengeMethod}&code_challenge=${code_challenge}`;
	}

	async getToken(code: string, email: string) {
		const { token_endpoint } = this.authorizationServerMetadata;
		const grantType = "authorization_code";
		const params = new URLSearchParams({
			grant_type: grantType,
			client_id: this.registerClientData.client_id,
			code: code,
			code_verifier: this.codeVerifier,
			redirect_uri: String(this.redirect_uris[0])
		});
		if (this.registerClientData.client_secret) {
			params.set("client_secret", this.registerClientData.client_secret);
		}
		if (this.resourceMetadata) {
			params.set("resource", this.resourceMetadata.resource);
		}

		const token = await fetch(token_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		}).then(res => res.json());

		this.saveToken(this.provider, email, {
			...token,
			expires_at: Date.now() + (token.expires_in || 3600) * 1000,
			meta: {
				authorizationServerMetadata: this.authorizationServerMetadata,
				registerClientData: this.registerClientData,
				resourceMetadata: this.resourceMetadata
			}
		});
		return token;
	}

	async refreshToken(provider: string, email: string) {
		const tokenData = this.loadToken(provider, email);
		if (!tokenData?.refresh_token) return;

		// restore metadata from tokenData.meta
		this.authorizationServerMetadata = tokenData.meta?.authorizationServerMetadata;
		this.registerClientData = tokenData.meta?.registerClientData;
		this.resourceMetadata = tokenData.meta?.resourceMetadata;

		if (!this.authorizationServerMetadata || !this.registerClientData) {
			throw new Error(`no metadata for ${provider} - ${email}`);
		}

		const { token_endpoint } = this.authorizationServerMetadata;
		const params = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: tokenData.refresh_token,
			client_id: this.registerClientData.client_id
		});
		if (this.registerClientData.client_secret) {
			params.set("client_secret", this.registerClientData.client_secret);
		}

		const newToken = await fetch(token_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		}).then(res => res.json());

		if (window.electronAPI?.envWrite) {
			await window.electronAPI.envWrite(email, { key: EnvOauthInfoMap[provider as keyof typeof EnvOauthInfoMap], value: newToken.access_token });
		}
		this.saveToken(provider, email, {
			...newToken,
			expires_at: Date.now() + (newToken.expires_in || 3600) * 1000,
			meta: {
				authorizationServerMetadata: this.authorizationServerMetadata,
				registerClientData: this.registerClientData,
			}
		});
		return newToken;
	}

	// --- local token storage for multiple accounts and providers ---

	getStorageKey() {
		return 'oauth_tokens';
	}

	getAllTokens(): Record<string, Record<string, any>> {
		const data = localStorage.getItem(this.getStorageKey());
		return data ? JSON.parse(data) : {};
	}

	saveToken(provider: string, email: string, tokenData: any) {
		const all = this.getAllTokens();
		if (!all[provider]) all[provider] = {};
		all[provider][email] = tokenData;
		localStorage.setItem(this.getStorageKey(), JSON.stringify(all));
	}


	loadToken(provider: string, email: string): any | null {
		const all = this.getAllTokens();
		return all?.[provider] && all?.[provider]?.[email] || null;
	}

	clearToken(provider: string, email: string) {
		const all = this.getAllTokens();
		if (all[provider] && all[provider][email]) {
			delete all[provider][email];
			if (Object.keys(all[provider]).length === 0) {
				delete all[provider];
			}
			localStorage.setItem(this.getStorageKey(), JSON.stringify(all));
		}
	}

	// --- PKCE tools ---
	async pkceChallenge(length: number = 43) {
		if (length < 43 || length > 128) throw `Expected length 43~128. Got ${length}`;
		const verifier = await this.generateVerifier(length);
		const challenge = await this.generateChallenge(verifier);
		return {
			code_verifier: verifier,
			code_challenge: challenge
		};
	}

	async generateVerifier(length: number) {
		return await this.random(length);
	}

	async generateChallenge(code_verifier: string) {
		const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier));
		return btoa(String.fromCharCode(...new Uint8Array(buffer)))
			.replace(/\//g, "_")
			.replace(/\+/g, "-")
			.replace(/=/g, "");
	}

	async random(size: number) {
		const mask = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
		const randomUints = crypto.getRandomValues(new Uint8Array(size));
		return Array.from(randomUints).map(i => mask[i % mask.length]).join('');
	}
}

// supported MCPs (can be extended multiple times)
export const mcpMap: Record<string, any> = {
	"Notion": {
		url: 'https://mcp.notion.com/mcp',
		provider: "notion"
	},
};
