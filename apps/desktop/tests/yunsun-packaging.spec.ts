// [yunsun] 品牌打包配置的测试。
import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { brandInstallerLocales, desktopProductName, resolveYunsunPackaging } from '../scripts/yunsun-packaging.mjs'

describe('resolveYunsunPackaging', () => {
  it('未设置或只有空白时返回 undefined（上游构建）', () => {
    expect(resolveYunsunPackaging({})).toBeUndefined()
    expect(resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: '  ' })).toBeUndefined()
    expect(desktopProductName({})).toBe('DeepSeek Harness')
  })

  it('设置后给出默认 appId、产物前缀和图标绝对路径', () => {
    const result = resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: ' 云隼智教 ' })
    expect(result).toMatchObject({ productName: '云隼智教', appId: 'com.yunsun.edu', artifactPrefix: 'yunsun-edu' })
    expect(result?.icons.macos).toMatch(/resources[\\/]yunsun[\\/]icon-macos\.png$/u)
    expect(result?.icons.windows).toMatch(/resources[\\/]yunsun[\\/]icon-windows\.png$/u)
    expect(result?.icons.tray).toMatch(/resources[\\/]yunsun[\\/]tray-windows\.ico$/u)
    expect(desktopProductName({ YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教' })).toBe('云隼智教')
  })

  it('接受自定义 appId，拒绝不是反向域名的值', () => {
    expect(resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X', YUNSUN_DESKTOP_APP_ID: ' com.example.edu ' })?.appId).toBe('com.example.edu')
    for (const appId of ['yunsun', 'com..edu', 'com.yunsun edu', 'com.yunsun_edu']) {
      expect(() => resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X', YUNSUN_DESKTOP_APP_ID: appId }))
        .toThrow('yunsun packaging: YUNSUN_DESKTOP_APP_ID must be a reverse-DNS identifier')
    }
  })
})

describe('brandInstallerLocales', () => {
  const locales = [
    { id: 'zh_CN', nsisLanguage: 'SIMPCHINESE', strings: { A: '安装 DeepSeek Harness 到本机', B: 'DeepSeek Harness 已就绪' }, uninstaller: { C: '卸载 DeepSeek Harness' } },
    { id: 'en_US', nsisLanguage: 'ENGLISH', strings: { A: 'Install DeepSeek Harness now' }, uninstaller: { C: 'Remove DeepSeek Harness' } },
  ]

  it('替换中英文产品名并去掉汉字旁的空格，不改入参', () => {
    const snapshot = structuredClone(locales)
    const branded = brandInstallerLocales(locales, '云隼智教')
    expect(branded[0]).toMatchObject({ id: 'zh_CN', strings: { A: '安装云隼智教到本机', B: '云隼智教已就绪' }, uninstaller: { C: '卸载云隼智教' } })
    expect(branded[1]).toMatchObject({ strings: { A: 'Install 云隼智教 now' }, uninstaller: { C: 'Remove 云隼智教' } })
    expect(locales).toEqual(snapshot)
    expect(branded[0]).not.toBe(locales[0])
  })

  it('产品名含正则特殊字符时按字面处理', () => {
    expect(brandInstallerLocales(locales.slice(0, 1), 'A+B')[0]?.strings.A).toBe('安装A+B到本机')
  })
})

describe('createElectronBuilderConfig', () => {
  const base = { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64', DSH_DESKTOP_APP_ID: 'com.example.upstream' }

  it('品牌环境下使用云隼的 appId、产品名、产物前缀、图标和麦克风文案（不再要求 DSH_DESKTOP_APP_ID）', () => {
    const { DSH_DESKTOP_APP_ID: _ignored, ...withoutAppId } = base
    const config = createElectronBuilderConfig({ ...withoutAppId, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教' }, 'darwin', 'arm64')
    expect(config.appId).toBe('com.yunsun.edu')
    expect(config.extraMetadata.dshDesktopAppId).toBe('com.yunsun.edu')
    expect(config.productName).toBe('云隼智教')
    expect(config.artifactName).toMatch(/^yunsun-edu-/u)
    expect(config.mac.icon).toMatch(/resources[\\/]yunsun[\\/]icon-macos\.png$/u)
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toBe('云隼智教 uses your microphone to transcribe speech into message drafts.')
  })

  it('不设品牌环境变量时保持上游原值', () => {
    const config = createElectronBuilderConfig(base, 'darwin', 'arm64')
    expect(config.appId).toBe('com.example.upstream')
    expect(config.productName).toBe('DeepSeek Harness')
    expect(config.artifactName).toMatch(/^deepseek-harness-/u)
    expect(config.mac.icon).toMatch(/resources[\\/]icon-macos\.png$/u)
    expect(config.mac.extendInfo.NSMicrophoneUsageDescription).toBe('DeepSeek Harness uses your microphone to transcribe speech into message drafts.')
  })
})
