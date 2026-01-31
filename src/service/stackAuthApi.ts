import { proxyFetchPost } from '@/api/http'

export type StackAuthFlowType = 'login' | 'signup'

type StackLoginResponse = {
	code?: number
	text?: string
	[key: string]: any
}

function isUserNotFoundResponse(res: StackLoginResponse | null | undefined): boolean {
	if (!res || typeof res !== 'object') return false
	if (res.code !== 1) return false
	const text = String(res.text ?? '').toLowerCase()
	return text.includes('user not found')
}

export async function loginByStackToken(params: {
	token: string
	type: StackAuthFlowType
	inviteCode?: string
}): Promise<StackLoginResponse> {
	const searchParams = new URLSearchParams()
	searchParams.set('token', params.token)
	searchParams.set('type', params.type)
	if (params.inviteCode) {
		searchParams.set('invite_code', params.inviteCode)
	}

	// Endpoint is defined as POST, but consumes query params.
	return proxyFetchPost(`/api/login-by_stack?${searchParams.toString()}`, {
		token: params.token,
		invite_code: params.inviteCode ?? '',
	})
}

/**
 * Attempts a passwordless SSO login first, and auto-creates the user if not found.
 * This matches the UX request: “check existing profile; if missing, create like signup”.
 */
export async function loginByStackWithAutoCreate(token: string): Promise<StackLoginResponse> {
	const loginRes = await loginByStackToken({ token, type: 'login' })
	if (!isUserNotFoundResponse(loginRes)) return loginRes
	return loginByStackToken({ token, type: 'signup' })
}
