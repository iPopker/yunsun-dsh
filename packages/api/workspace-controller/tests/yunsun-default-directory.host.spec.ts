import { describe, expect, it } from 'vitest'
import { defaultWorkspaceDirectory, defaultWorkspaceParentName } from '../src/default-directory.ts'

// [yunsun] P1 品牌：默认工作区的上级目录名。上游 default-directory.host.spec.ts 不变。
describe('yunsun default workspace directory', () => {
  it('只有 DSH_PRODUCT_BRAND=yunsun 时换成云隼智教', () => {
    expect(defaultWorkspaceParentName({ DSH_PRODUCT_BRAND: 'yunsun' })).toBe('云隼智教')
    expect(defaultWorkspaceParentName({})).toBe('deepseek-harness')
    expect(defaultWorkspaceParentName({ DSH_PRODUCT_BRAND: 'official' })).toBe('deepseek-harness')
  })

  it.each([
    ['darwin', '/Users/a/Documents', '/Users/a/Documents/云隼智教/default-workspace'],
    ['win32', 'D:\\Documents', 'D:\\Documents\\云隼智教\\default-workspace'],
  ] as const)('%s 下放在 Documents/云隼智教/default-workspace', async (platform, documents, expected) => {
    await expect(defaultWorkspaceDirectory(documents, new AbortController().signal, { platform, env: { DSH_PRODUCT_BRAND: 'yunsun' } }))
      .resolves.toBe(expected)
  })
})
