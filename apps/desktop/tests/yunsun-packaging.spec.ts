// [yunsun] 品牌打包配置的测试。
import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { brandInstallerLocales, desktopArtifactStem, desktopProductName, resolveYunsunPackaging } from '../scripts/yunsun-packaging.mjs'

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

  it('YUNSUN_DESKTOP_VERSION：不设为 undefined，接受 semver，拒绝非 semver', () => {
    expect(resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X' })?.version).toBeUndefined()
    expect(resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X', YUNSUN_DESKTOP_VERSION: ' 3.0.0 ' })?.version).toBe('3.0.0')
    expect(resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X', YUNSUN_DESKTOP_VERSION: '3.0.1-beta.2' })?.version).toBe('3.0.1-beta.2')
    for (const version of ['V3.0', '3.0', '03.0.0', '3.0.0.']) {
      expect(() => resolveYunsunPackaging({ YUNSUN_DESKTOP_PRODUCT_NAME: 'X', YUNSUN_DESKTOP_VERSION: version }))
        .toThrow('yunsun packaging: YUNSUN_DESKTOP_VERSION must be a semver version')
    }
  })
})

describe('desktopArtifactStem', () => {
  it('上游用 deepseek-harness 和构建版本；品牌用 yunsun-edu，有 YUNSUN_DESKTOP_VERSION 时用它', () => {
    expect(desktopArtifactStem({}, '0.2.2-rc.3')).toBe('deepseek-harness-0.2.2-rc.3')
    expect(desktopArtifactStem({ YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教' }, '0.2.2-rc.3')).toBe('yunsun-edu-0.2.2-rc.3')
    expect(desktopArtifactStem({ YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教', YUNSUN_DESKTOP_VERSION: '3.0.0' }, '0.2.2-rc.3')).toBe('yunsun-edu-3.0.0')
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
    expect(config.extraMetadata.version).toBeUndefined()
  })

  it('品牌环境设置 YUNSUN_DESKTOP_VERSION 时覆盖打包后的应用版本，优先于 package-target 写入的 DSH_DESKTOP_BUILD_VERSION', () => {
    const config = createElectronBuilderConfig({ ...base, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教', YUNSUN_DESKTOP_VERSION: '3.0.0' }, 'darwin', 'arm64')
    expect(config.extraMetadata.version).toBe('3.0.0')
    // package-target.ts 总会把 DSH_DESKTOP_BUILD_VERSION 设成上游构建版本，品牌版本仍然生效。
    const withBuildVersion = createElectronBuilderConfig({ ...base, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教', YUNSUN_DESKTOP_VERSION: '3.0.0', DSH_DESKTOP_BUILD_VERSION: '0.2.2-rc.3' }, 'darwin', 'arm64')
    expect(withBuildVersion.extraMetadata.version).toBe('3.0.0')
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
