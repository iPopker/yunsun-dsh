// [yunsun] P4 预装 bundle 和打包期配置的测试。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyYunsunPackagedEnv,
  parseYunsunPackagedConfig,
  preinstallYunsunBundle,
  readYunsunPackagedResources,
  YUNSUN_DSH_HOME_DIR_NAME,
  YUNSUN_PREINSTALL_STATE_FILE,
  type YunsunPackagedResources,
} from '../src/yunsun-preinstall.ts'
import { DSH_VERSION, fakePnpm } from './yunsun-test-support.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'yunsun-preinstall-'))
  roots.push(root)
  return root
}

const config = {
  schemaVersion: 1,
  serverBaseUrl: 'https://yunsun.example.test',
  bundle: { name: '@yunsun/dsh-edu', version: '0.0.0-build.1', file: 'yunsun-dsh-edu-0.0.0-build.1.tgz' },
} as const

function resourcesDir(root: string, value: unknown = config, withTarball = true): string {
  const resources = join(root, 'resources')
  mkdirSync(join(resources, 'yunsun'), { recursive: true })
  writeFileSync(join(resources, 'yunsun', 'yunsun.json'), JSON.stringify(value))
  if (withTarball) writeFileSync(join(resources, 'yunsun', config.bundle.file), 'tgz')
  return resources
}

function profile(root: string): string {
  const dir = join(root, 'profile')
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  return dir
}

describe('yunsun packaged config', () => {
  it('没有标记时返回 undefined（上游构建、开发版）', () => {
    expect(readYunsunPackagedResources(undefined)).toBeUndefined()
    expect(readYunsunPackagedResources(temporaryRoot())).toBeUndefined()
  })

  it('读取合法配置，缺 bundle 文件或字段不合法时抛出', () => {
    expect(readYunsunPackagedResources(resourcesDir(temporaryRoot()))?.config).toEqual(config)
    expect(() => readYunsunPackagedResources(resourcesDir(temporaryRoot(), config, false))).toThrow('缺少 bundle 文件')
    expect(() => parseYunsunPackagedConfig({ ...config, serverBaseUrl: 'ftp://x' })).toThrow('http/https')
    expect(() => parseYunsunPackagedConfig({ ...config, serverBaseUrl: 'nope' })).toThrow('不是合法 URL')
    expect(() => parseYunsunPackagedConfig({ ...config, schemaVersion: 2 })).toThrow('schemaVersion')
    expect(() => parseYunsunPackagedConfig({ ...config, bundle: { ...config.bundle, file: '../x.tgz' } })).toThrow('bundle 必须')
    expect(() => parseYunsunPackagedConfig({ ...config, bundle: { ...config.bundle, name: 'other' } })).toThrow('bundle 必须')
  })

  it('环境变量：补齐缺的，不覆盖已有的', () => {
    const resources = readYunsunPackagedResources(resourcesDir(temporaryRoot())) as YunsunPackagedResources
    const env: Record<string, string | undefined> = { YUNSUN_SERVER_URL: 'http://localhost:3000' }
    applyYunsunPackagedEnv(env, resources)
    expect(env).toEqual({
      YUNSUN_SERVER_URL: 'http://localhost:3000',
      DSH_PRODUCT_BRAND: 'yunsun',
      DSH_HOME: join(homedir(), YUNSUN_DSH_HOME_DIR_NAME),
      DSH_TELEMETRY_DISABLED: '1',
      DSH_TELEMETRY_MODE: 'DISABLED',
    })
    const fresh: Record<string, string | undefined> = {}
    applyYunsunPackagedEnv(fresh, resources)
    expect(fresh.YUNSUN_SERVER_URL).toBe('https://yunsun.example.test')
  })

  it('已设 DSH_HOME 时不覆盖；默认落在 home 下的 .yunsun-edu', () => {
    const resources = readYunsunPackagedResources(resourcesDir(temporaryRoot())) as YunsunPackagedResources
    const custom: Record<string, string | undefined> = { DSH_HOME: '/custom/dsh-home' }
    applyYunsunPackagedEnv(custom, resources)
    expect(custom.DSH_HOME).toBe('/custom/dsh-home')
    const fresh: Record<string, string | undefined> = {}
    applyYunsunPackagedEnv(fresh, resources)
    expect(YUNSUN_DSH_HOME_DIR_NAME).toBe('.yunsun-edu')
    expect(fresh.DSH_HOME).toBe(join(homedir(), '.yunsun-edu'))
  })
})

describe('preinstallYunsunBundle', () => {
  it('复制 tgz、离线 pnpm add、登记 bundle、写状态和 startup.json；第二次跳过', async () => {
    const root = temporaryRoot()
    const resources = readYunsunPackagedResources(resourcesDir(root)) as YunsunPackagedResources
    const dir = profile(root)
    const calls: { args: readonly string[]; cwd: string }[] = []
    const runPnpm = fakePnpm(calls)
    expect(await preinstallYunsunBundle({ profileDir: dir, resources, runPnpm, dshVersion: DSH_VERSION })).toBe('installed')
    expect(calls).toEqual([{ args: ['add', `./yunsun-packages/${config.bundle.file}`, '--offline', '--ignore-scripts'], cwd: dir }])
    expect(existsSync(join(dir, 'yunsun-packages', config.bundle.file))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@yunsun/dsh-edu'])
    expect(JSON.parse(readFileSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE), 'utf8'))).toEqual({ bundle: '@yunsun/dsh-edu', version: config.bundle.version })
    const startup = JSON.parse(readFileSync(join(dir, 'yunsun-updates', 'startup.json'), 'utf8')) as Record<string, unknown>
    expect(startup).toMatchObject({ version: config.bundle.version, previousFile: null })
    expect(await preinstallYunsunBundle({ profileDir: dir, resources, runPnpm, dshVersion: DSH_VERSION })).toBe('current')
    expect(calls).toHaveLength(1)
  })

  it('版本变化时重新安装，previousFile 指向旧版 tgz，且不重复登记', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    const calls: { args: readonly string[]; cwd: string }[] = []
    const runPnpm = fakePnpm(calls)
    const first = readYunsunPackagedResources(resourcesDir(root)) as YunsunPackagedResources
    await preinstallYunsunBundle({ profileDir: dir, resources: first, runPnpm, dshVersion: DSH_VERSION })
    const next = { ...config, bundle: { ...config.bundle, version: '0.0.0-build.2', file: 'yunsun-dsh-edu-0.0.0-build.2.tgz' } }
    writeFileSync(join(root, 'resources', 'yunsun', next.bundle.file), 'tgz')
    const second = readYunsunPackagedResources(resourcesDir(root, next, false)) as YunsunPackagedResources
    expect(await preinstallYunsunBundle({ profileDir: dir, resources: second, runPnpm, dshVersion: DSH_VERSION })).toBe('installed')
    expect(calls).toHaveLength(2)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles.filter(name => name === '@yunsun/dsh-edu')).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(dir, 'yunsun-updates', 'startup.json'), 'utf8'))).toMatchObject({ version: '0.0.0-build.2', previousFile: config.bundle.file })
  })

  it('pnpm 失败时抛出，不写状态也不登记', async () => {
    const root = temporaryRoot()
    const resources = readYunsunPackagedResources(resourcesDir(root)) as YunsunPackagedResources
    const dir = profile(root)
    const runPnpm = (): Promise<void> => Promise.reject(new Error('offline tarball missing'))
    await expect(preinstallYunsunBundle({ profileDir: dir, resources, runPnpm, dshVersion: DSH_VERSION })).rejects.toThrow('offline tarball missing')
    expect(existsSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE))).toBe(false)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).not.toContain('@yunsun/dsh-edu')
  })
})
