// [yunsun] P3 不使用原版 Welcome 的测试。
import { describe, expect, it } from 'vitest'
import { needsWelcome } from '../src/welcome-api.ts'

const signedOut = { loggedIn: false, hasApiKey: false }

describe('yunsun welcome gate', () => {
  it('不设 DSH_PRODUCT_BRAND 时保持上游行为：未登录且没有 key 才需要 Welcome', () => {
    expect(needsWelcome(signedOut, {})).toBe(true)
    expect(needsWelcome({ loggedIn: true, hasApiKey: false }, {})).toBe(false)
    expect(needsWelcome({ loggedIn: false, hasApiKey: true }, {})).toBe(false)
    expect(needsWelcome(signedOut, { DSH_PRODUCT_BRAND: 'official' })).toBe(true)
  })

  it('DSH_PRODUCT_BRAND=yunsun 时恒为 false，包括冷启动和退出登录后', () => {
    const env = { DSH_PRODUCT_BRAND: 'yunsun' }
    expect(needsWelcome(signedOut, env)).toBe(false)
    expect(needsWelcome({ loggedIn: true, hasApiKey: true }, env)).toBe(false)
  })
})
