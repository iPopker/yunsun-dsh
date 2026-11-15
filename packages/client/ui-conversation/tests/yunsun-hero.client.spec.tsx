// @vitest-environment jsdom
// [yunsun] P1 品牌：品牌模式下首页换成云隼智教文案，不显示「预览版」；不设标记时保持上游原样。
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { HeroShell } from '../src/client/skeleton/EmptyHero.tsx'

const brandFlag = globalThis as { __DSH_PRODUCT_BRAND__?: unknown }
const renderSlot = ((_key: string, _owner: object, opts?: { fallback?: unknown }) => opts?.fallback ?? null) as never

afterEach(() => {
  cleanup()
  delete brandFlag.__DSH_PRODUCT_BRAND__
})

describe('yunsun hero', () => {
  it('品牌模式：中文标题、英文标题，且没有预览版标签', () => {
    brandFlag.__DSH_PRODUCT_BRAND__ = 'yunsun'
    const zhView = render(<HeroShell t={makeTranslate(zh, commonZh)} renderSlot={renderSlot} />)
    expect(zhView.getByText('今天想备什么课？')).toBeTruthy()
    expect(zhView.queryByText('探索未至之境')).toBeNull()
    expect(zhView.queryByText('预览版')).toBeNull()
    zhView.unmount()
    const enView = render(<HeroShell t={makeTranslate(en, commonEn)} renderSlot={renderSlot} />)
    expect(enView.getByText('What shall we prepare today?')).toBeTruthy()
    expect(enView.queryByText('Preview')).toBeNull()
  })

  it('未设品牌标记：保持上游文案和预览版标签', () => {
    const view = render(<HeroShell t={makeTranslate(zh, commonZh)} renderSlot={renderSlot} />)
    expect(view.getByText('探索未至之境')).toBeTruthy()
    expect(view.getByText('预览版')).toBeTruthy()
  })
})
