// @vitest-environment jsdom
// [yunsun] 品牌：品牌模式下客户端文案里的上游产品名换成云隼智教；不设标记时保持上游原样。
import { afterEach, describe, expect, it } from 'vitest'
import { YUNSUN_PRODUCT_NAME, yunsunBrandActive, yunsunBrandText } from '../src/client/yunsun-brand.ts'

const brandFlag = globalThis as { __DSH_PRODUCT_BRAND__?: unknown }

afterEach(() => {
  delete brandFlag.__DSH_PRODUCT_BRAND__
})

describe('yunsun brand text', () => {
  it('不设标记时原样返回', () => {
    expect(yunsunBrandActive()).toBe(false)
    expect(yunsunBrandText('返回 DeepSeek Harness')).toBe('返回 DeepSeek Harness')
  })

  it('品牌模式下替换产品名，并贴合中文标点', () => {
    brandFlag.__DSH_PRODUCT_BRAND__ = 'yunsun'
    expect(yunsunBrandActive()).toBe(true)
    expect(yunsunBrandText('返回 DeepSeek Harness')).toBe(`返回${YUNSUN_PRODUCT_NAME}`)
    expect(yunsunBrandText('当前未登录 DeepSeek Harness 账号')).toBe(`当前未登录${YUNSUN_PRODUCT_NAME}账号`)
  })

  it('不碰模型提供商名称', () => {
    brandFlag.__DSH_PRODUCT_BRAND__ = 'yunsun'
    expect(yunsunBrandText('配置 DeepSeek 官方模型')).toBe('配置 DeepSeek 官方模型')
  })

  it('侧栏版本位的内部代号 DSH 也换成产品名', () => {
    brandFlag.__DSH_PRODUCT_BRAND__ = 'yunsun'
    expect(yunsunBrandText('DSH 本地构建')).toBe(`${YUNSUN_PRODUCT_NAME}本地构建`)
    expect(yunsunBrandText('DSH Local Build')).toBe(`${YUNSUN_PRODUCT_NAME} Local Build`)
    // 连写的标识（skill 名、环境变量）不能被改。
    expect(yunsunBrandText('dsh-doc skill')).toBe('dsh-doc skill')
    expect(yunsunBrandText('DSH_CLIENT_TITLE')).toBe('DSH_CLIENT_TITLE')
  })
})
