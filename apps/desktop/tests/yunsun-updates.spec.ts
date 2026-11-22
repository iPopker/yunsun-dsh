// [yunsun] P2 关闭整包更新的测试：云隼构建不检查更新、不请求强制策略、不暴露更新界面，上游构建不变。
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopProductApi } from '../src/ipc.ts'
import { resolveDesktopPolicyConfig } from '../src/mandatory-update-policy.ts'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { yunsunUpdatesDisabledForPackaging } from '../scripts/yunsun-packaging.mjs'
import {
  YUNSUN_UPDATES_DISABLED_ARGUMENT,
  yunsunUpdatesBridgeExposed,
  yunsunUpdatesDisabledArguments,
} from '../src/yunsun-updates-argument.ts'
import { yunsunCoordinatorEnabled, yunsunMandatoryPolicyInput, yunsunUpdatesDisabled } from '../src/yunsun-updates.ts'

const electron = vi.hoisted(() => ({
  app: { isPackaged: false },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))
vi.mock('electron', () => electron)
vi.mock('electron-updater', () => ({ default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true } } }))
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform: vi.fn(), syncWindowFullscreen: vi.fn() }))
vi.mock('../src/preload-theme.ts', () => ({ syncNativeTheme: vi.fn() }))
vi.mock('../src/preload-windows.ts', () => ({ syncWindowsAppearance: vi.fn() }))
vi.mock('../src/preload-mandatory-overlay.ts', () => ({ installMandatoryUpdateOverlay: vi.fn() }))

const { DesktopUpdateCoordinator } = await import('../src/update-coordinator.ts')

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules()
})

const bundleFile = 'yunsun-dsh-edu-0.0.0-build.1.tgz'
function resourcesWith(yunsunConfig: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'yunsun-updates-'))
  roots.push(root)
  if (yunsunConfig) {
    mkdirSync(join(root, 'yunsun'))
    writeFileSync(join(root, 'yunsun', 'yunsun.json'), JSON.stringify({
      schemaVersion: 1, serverBaseUrl: 'https://yunsun.example.test',
      bundle: { name: '@yunsun/dsh-edu', version: '0.0.0-build.1', file: bundleFile },
    }))
    writeFileSync(join(root, 'yunsun', bundleFile), '')
  }
  return root
}

describe('yunsunUpdatesDisabled', () => {
  it('按 resources/yunsun/yunsun.json 判定，不看 DSH_PRODUCT_BRAND', () => {
    vi.stubEnv('DSH_PRODUCT_BRAND', 'official')
    expect(yunsunUpdatesDisabled(resourcesWith(true))).toBe(true)
    vi.stubEnv('DSH_PRODUCT_BRAND', 'yunsun')
    expect(yunsunUpdatesDisabled(resourcesWith(false))).toBe(false)
    expect(yunsunUpdatesDisabled(undefined)).toBe(false)
  })

  it('yunsun.json 不合法时抛出，不当成上游构建继续联网', () => {
    const root = resourcesWith(true)
    writeFileSync(join(root, 'yunsun', 'yunsun.json'), '{"schemaVersion":2}')
    expect(() => yunsunUpdatesDisabled(root)).toThrow('yunsun.json: schemaVersion')
  })
})

describe('update coordinator', () => {
  function coordinator(enabled: (() => boolean) | undefined) {
    const events = new EventEmitter()
    const checkForUpdates = vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: '9.9.9' } }))
    const downloadUpdate = vi.fn()
    const updater = Object.assign(events, { checkForUpdates, downloadUpdate, quitAndInstall: vi.fn() }) as unknown as AppUpdater
    const instance = new DesktopUpdateCoordinator(state => state, async () => true, updater, enabled, () => '1.0.0')
    return { instance, checkForUpdates, downloadUpdate }
  }

  it('云隼构建：自动和手动检查都不调用 autoUpdater', async () => {
    const { instance, checkForUpdates, downloadUpdate } = coordinator(yunsunCoordinatorEnabled(true))
    expect(await instance.check()).toMatchObject({ phase: 'error', failedOperation: 'check' })
    expect(await instance.check(true)).toMatchObject({ phase: 'error', failedOperation: 'check' })
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(downloadUpdate).not.toHaveBeenCalled()
    instance.dispose()
  })

  it('上游构建：不覆盖 enabled，协调器沿用自己的默认判定；启用时照常检查', async () => {
    expect(yunsunCoordinatorEnabled(false)).toBeUndefined()
    const { instance, checkForUpdates } = coordinator(() => true)
    expect(await instance.check()).toMatchObject({ phase: 'available', version: '9.9.9' })
    expect(checkForUpdates).toHaveBeenCalledOnce()
    instance.dispose()
  })
})

describe('mandatory update policy', () => {
  const policy = { origin: 'https://policy.example.test', allowedPageOrigins: ['https://downloads.example.test'] }

  it('云隼构建：策略输入恒为 undefined，不创建策略，也没有任何请求', () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    expect(resolveDesktopPolicyConfig(yunsunMandatoryPolicyInput(true, policy))).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('上游构建：策略输入原样传递', () => {
    expect(yunsunMandatoryPolicyInput(false, policy)).toBe(policy)
    expect(resolveDesktopPolicyConfig(yunsunMandatoryPolicyInput(false, policy))?.origin).toBe(policy.origin)
    expect(yunsunMandatoryPolicyInput(false, undefined)).toBeUndefined()
  })
})

describe('preload', () => {
  async function exposedApi(argv: string[]): Promise<DshDesktopProductApi> {
    vi.stubGlobal('process', { ...process, argv, isMainFrame: true })
    vi.stubGlobal('location', new URL('dsh-app://app/index.html'))
    await import('../src/preload-app.ts')
    return electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as DshDesktopProductApi
  }
  beforeEach(() => { electron.contextBridge.exposeInMainWorld.mockClear() })

  it('主进程只在云隼构建加参数', () => {
    expect(yunsunUpdatesDisabledArguments(true)).toEqual([YUNSUN_UPDATES_DISABLED_ARGUMENT])
    expect(yunsunUpdatesDisabledArguments(false)).toEqual([])
    expect(yunsunUpdatesBridgeExposed(['electron'])).toBe(true)
    expect(yunsunUpdatesBridgeExposed(['electron', YUNSUN_UPDATES_DISABLED_ARGUMENT])).toBe(false)
  })

  it('云隼构建：不暴露 updates，其他接口仍在', async () => {
    const api = await exposedApi(['electron', YUNSUN_UPDATES_DISABLED_ARGUMENT])
    expect(api).not.toHaveProperty('updates')
    expect(api.fileActions).toBeDefined()
    expect(electron.ipcRenderer.on.mock.calls.some(([channel]) => channel === DESKTOP_IPC.updatesPresentation)).toBe(false)
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(DESKTOP_IPC.updatesStatus)
  })

  it('上游构建：照常暴露 updates', async () => {
    const api = await exposedApi(['electron'])
    await api.updates?.status()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.updatesStatus)
  })
})

describe('electron-builder configuration', () => {
  const unsignedWindows = { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64', DSH_DESKTOP_APP_ID: 'com.example.upstream' }

  it('品牌打包：publish 为 null，不写更新策略；没有策略环境变量也不报错', () => {
    const config = createElectronBuilderConfig({ ...unsignedWindows, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教' }, 'darwin', 'arm64')
    expect(config.publish).toBeNull()
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
  })

  it('只打包了云隼资源目录也算云隼构建', () => {
    const env = { ...unsignedWindows, YUNSUN_RESOURCES_DIR: '/resources/yunsun' }
    expect(yunsunUpdatesDisabledForPackaging(env)).toBe(true)
    expect(createElectronBuilderConfig(env, 'darwin', 'arm64').publish).toBeNull()
  })

  it('品牌打包环境即使带着更新源和策略设置也不写入', () => {
    const env = { ...unsignedWindows, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教', DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
      DOWNLOAD_TEST_ORIGIN: 'https://download.example.test', DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.test' }
    const config = createElectronBuilderConfig(env, 'darwin', 'arm64')
    expect(config.publish).toBeNull()
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
  })

  it('非云隼：Windows 无签名打包仍要求策略配置，与上游一致', () => {
    expect(yunsunUpdatesDisabledForPackaging(unsignedWindows)).toBe(false)
    expect(() => createElectronBuilderConfig(unsignedWindows, 'win32', 'x64')).toThrow(/mandatory|policy/iu)
  })

  it('打包前校验：品牌打包不要求策略和更新源，非品牌仍然要求', () => {
    const base = { DSH_DESKTOP_APP_ID: 'com.example.upstream' }
    const target = { platform: 'win32', arch: 'x64' } as const
    expect(() => { validateDesktopPackageEnvironment(base, target, { unsigned: true }) })
      .toThrow('DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN requires an HTTPS origin')
    const branded = { ...base, YUNSUN_DESKTOP_PRODUCT_NAME: '云隼智教' }
    expect(() => { validateDesktopPackageEnvironment(branded, target, { unsigned: true }) }).not.toThrow()
    const resourcesOnly = { ...base, YUNSUN_RESOURCES_DIR: '/resources/yunsun' }
    expect(() => { validateDesktopPackageEnvironment(resourcesOnly, target, { unsigned: true }) }).not.toThrow()
  })
})
