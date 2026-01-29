import { describe, it, expect, vi, beforeEach } from 'vitest'

import { loginByStackWithAutoCreate, loginByStackToken } from '../../../src/service/stackAuthApi'

vi.mock('@/api/http', () => ({
  proxyFetchPost: vi.fn(),
}))

describe('stackAuthApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to signup when login returns user not found', async () => {
    const { proxyFetchPost } = await import('@/api/http')

    vi.mocked(proxyFetchPost)
      .mockResolvedValueOnce({ code: 1, text: 'User not found' })
      .mockResolvedValueOnce({ code: 0, token: 't', email: 'e@example.com' })

    const res = await loginByStackWithAutoCreate('stack-token')

    expect(res.code).toBe(0)
    expect(vi.mocked(proxyFetchPost)).toHaveBeenCalledTimes(2)

    const firstUrl = vi.mocked(proxyFetchPost).mock.calls[0][0] as string
    const secondUrl = vi.mocked(proxyFetchPost).mock.calls[1][0] as string

    expect(firstUrl).toContain('/api/login-by_stack?')
    expect(firstUrl).toContain('type=login')
    expect(secondUrl).toContain('type=signup')
  })

  it('does not fall back to signup for account/password error', async () => {
    const { proxyFetchPost } = await import('@/api/http')

    vi.mocked(proxyFetchPost).mockResolvedValueOnce({ code: 10, text: 'Account or password error' })

    const res = await loginByStackWithAutoCreate('stack-token')

    expect(res.code).toBe(10)
    expect(res.text).toBe('Account or password error')
    expect(vi.mocked(proxyFetchPost)).toHaveBeenCalledTimes(1)

    const firstUrl = vi.mocked(proxyFetchPost).mock.calls[0][0] as string
    expect(firstUrl).toContain('/api/login-by_stack?')
    expect(firstUrl).toContain('type=login')
  })

  it('includes invite_code in query when provided', async () => {
    const { proxyFetchPost } = await import('@/api/http')

    vi.mocked(proxyFetchPost).mockResolvedValueOnce({ code: 0 })

    await loginByStackToken({ token: 'stack-token', type: 'signup', inviteCode: 'INV123' })

    const url = vi.mocked(proxyFetchPost).mock.calls[0][0] as string
    expect(url).toContain('invite_code=INV123')
  })
})
