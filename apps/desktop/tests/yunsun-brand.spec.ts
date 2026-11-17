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

  it('换代产品名的同时清掉内部代号 DSH / dsh web', () => {
    const messages: Record<string, string> = {
      startupAddressInUse:
        '有其他正在运行的 DSH（如其他 dsh web、桌面端），无法同时启动，请退出其他正在运行的 DSH 后重启。',
      env: 'DSH_CLIENT_TITLE is read at build time',
    }
    applyYunsunBrand(messages)
    expect(messages['startupAddressInUse']).toBe(
      '有其他正在运行的云隼智教（如其他云隼智教网页版、桌面端），无法同时启动，请退出其他正在运行的云隼智教后重启。',
    )
    // 环境变量名这类连写标识不能被改。
    expect(messages['env']).toBe('DSH_CLIENT_TITLE is read at build time')
  })
})
