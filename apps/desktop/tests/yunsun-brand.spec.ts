// [yunsun] P1 品牌替换的测试。
import { describe, expect, it } from 'vitest'
import { applyYunsunBrand, productName, yunsunBrandEnabled } from '../src/yunsun-brand.ts'

describe('yunsun brand', () => {
  it('只有 DSH_PRODUCT_BRAND=yunsun 时启用', () => {
    expect(yunsunBrandEnabled({ DSH_PRODUCT_BRAND: 'yunsun' })).toBe(true)
    expect(yunsunBrandEnabled({})).toBe(false)
    expect(yunsunBrandEnabled({ DSH_PRODUCT_BRAND: 'official' })).toBe(false)
    expect(productName({ DSH_PRODUCT_BRAND: 'yunsun' })).toBe('云隼智教')
    expect(productName({})).toBe('DeepSeek Harness')
  })

  it('替换产品名，中文里不留多余空格，其他文案不变', () => {
    const messages: Record<string, string> = {
      about: 'About DeepSeek Harness',
      quit: '退出 DeepSeek Harness',
      quitTitle: '退出 DeepSeek Harness？',
      ja: 'DeepSeek Harness を終了しますか？',
      model: '配置官方 DeepSeek 模型',
      copy: 'Copy',
    }
    applyYunsunBrand(messages)
    expect(messages).toEqual({
      about: 'About 云隼智教',
      quit: '退出云隼智教',
      quitTitle: '退出云隼智教？',
      ja: '云隼智教 を終了しますか？',
      model: '配置官方 DeepSeek 模型',
      copy: 'Copy',
    })
  })
})
