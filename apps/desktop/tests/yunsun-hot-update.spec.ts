// [yunsun] P4 教育插件热更新的预装侧：hotUpdate/updaterBundle 解析、启动选包、home 层补丁（ADR 0043）。
import { createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalManifestBytes,
  parseManifest,
} from '../src/yunsun-hot-update-manifest.ts'
import {
  ensureYunsunHomePatch,
  YUNSUN_HOME_PATCH_DISABLED_IDS,
  YUNSUN_HOME_PATCH_MARKER,
} from '../src/yunsun-hot-update-home-patch.ts'
import {
  applyYunsunPackagedEnv,
  parseYunsunPackagedConfig,
  preinstallYunsunBundle,
  readYunsunPackagedResources,
  YUNSUN_PREINSTALL_STATE_FILE,
  type YunsunPackagedResources,
} from '../src/yunsun-preinstall.ts'
import { DSH_VERSION, fakePnpm, installedPackage, makeKey, writeStaged } from './yunsun-test-support.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'yunsun-hot-update-'))
  roots.push(root)
  return root
}

const key = makeKey()
const BUNDLED = '0.0.0-build.20260101000000'
const updaterRef = { name: '@yunsun/dsh-edu-updater', version: '1.0.0', file: 'yunsun-dsh-edu-updater-1.0.0.tgz' }
const baseConfig = {
  schemaVersion: 1,
  serverBaseUrl: 'https://yunsun.example.test',
  bundle: { name: '@yunsun/dsh-edu', version: BUNDLED, file: `yunsun-dsh-edu-${BUNDLED}.tgz` },
}
const hotUpdate = { feedUrl: 'https://updates.example.test/feed/', publicKeys: { [key.keyId]: key.publicPem } }

function resources(root: string, extra: Record<string, unknown> = {}, bundledVersion = BUNDLED): YunsunPackagedResources {
  const dir = join(root, 'resources', 'yunsun')
  mkdirSync(dir, { recursive: true })
  const config = { ...baseConfig, bundle: { ...baseConfig.bundle, version: bundledVersion, file: `yunsun-dsh-edu-${bundledVersion}.tgz` }, ...extra }
  writeFileSync(join(dir, 'yunsun.json'), JSON.stringify(config))
  writeFileSync(join(dir, config.bundle.file), 'tgz')
  writeFileSync(join(dir, updaterRef.file), 'tgz')
  return readYunsunPackagedResources(join(root, 'resources')) as YunsunPackagedResources
}

function profile(root: string): string {
  const dir = join(root, 'profile')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {}, dsh: { profile: { bundles: [] } } }))
  return dir
}

const silent: { info: (message: string) => void; error: (message: string) => void } = { info: () => undefined, error: () => undefined }
function run(dir: string, res: YunsunPackagedResources, calls: { args: readonly string[]; cwd: string }[] = [], log = silent) {
  return preinstallYunsunBundle({ profileDir: dir, resources: res, runPnpm: fakePnpm(calls), dshVersion: DSH_VERSION, log })
}
function installedVersion(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, 'node_modules', '@yunsun', 'dsh-edu', 'package.json'), 'utf8')) as { version: string }).version
}
function startup(dir: string): Record<string, unknown> | undefined {
  const path = join(dir, 'yunsun-updates', 'startup.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : undefined
}

describe('yunsun.json 新字段', () => {
  it('缺省时不启用，合法时解析', () => {
    expect(parseYunsunPackagedConfig(baseConfig)).not.toHaveProperty('hotUpdate')
    expect(parseYunsunPackagedConfig(baseConfig)).not.toHaveProperty('updaterBundle')
    const parsed = parseYunsunPackagedConfig({ ...baseConfig, updaterBundle: updaterRef, hotUpdate })
    expect(parsed.updaterBundle).toEqual(updaterRef)
    expect(parsed.hotUpdate).toEqual(hotUpdate)
  })

  it.each([
    ['feedUrl 不是 http/https', { ...hotUpdate, feedUrl: 'ftp://x/' }, 'hotUpdate.feedUrl 必须是 http/https'],
    ['feedUrl 不以 / 结尾', { ...hotUpdate, feedUrl: 'https://x.test/feed' }, '必须以 /'],
    ['feedUrl 不是 URL', { ...hotUpdate, feedUrl: 'nope' }, 'hotUpdate.feedUrl 不是合法 URL'],
    ['publicKeys 为空', { ...hotUpdate, publicKeys: {} }, 'hotUpdate.publicKeys 至少'],
    ['公钥不是 PEM', { ...hotUpdate, publicKeys: { k: 'junk' } }, 'hotUpdate.publicKeys.k'],
  ])('hotUpdate 非法：%s', (_name, value, message) => {
    expect(() => parseYunsunPackagedConfig({ ...baseConfig, hotUpdate: value })).toThrow(message)
  })

  it('公钥不是 ed25519 时抛错', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(() => parseYunsunPackagedConfig({ ...baseConfig, hotUpdate: { ...hotUpdate, publicKeys: { k: rsa } } })).toThrow('必须是 ed25519')
  })

  it('updaterBundle 非法或文件缺失时抛错', () => {
    expect(() => parseYunsunPackagedConfig({ ...baseConfig, updaterBundle: { ...updaterRef, name: 'x' } })).toThrow('updaterBundle')
    expect(() => parseYunsunPackagedConfig({ ...baseConfig, updaterBundle: { ...updaterRef, file: '../u.tgz' } })).toThrow('updaterBundle')
    const root = temporaryRoot()
    const dir = join(root, 'resources', 'yunsun')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'yunsun.json'), JSON.stringify({ ...baseConfig, updaterBundle: updaterRef }))
    writeFileSync(join(dir, baseConfig.bundle.file), 'tgz')
    expect(() => readYunsunPackagedResources(join(root, 'resources'))).toThrow('缺少更新器 bundle 文件')
  })

  it('环境变量：设置热更新变量但不覆盖已有值，无 hotUpdate 时不设', () => {
    const withHot = resources(temporaryRoot(), { hotUpdate })
    const env: Record<string, string | undefined> = { YUNSUN_HOT_UPDATE_FEED_URL: 'https://override.test/' }
    applyYunsunPackagedEnv(env, withHot)
    expect(env.YUNSUN_HOT_UPDATE_FEED_URL).toBe('https://override.test/')
    expect(JSON.parse(env.YUNSUN_HOT_UPDATE_PUBLIC_KEYS as string)).toEqual(hotUpdate.publicKeys)
    const plain: Record<string, string | undefined> = {}
    applyYunsunPackagedEnv(plain, resources(temporaryRoot()))
    expect(plain).not.toHaveProperty('YUNSUN_HOT_UPDATE_FEED_URL')
    expect(plain).not.toHaveProperty('YUNSUN_HOT_UPDATE_PUBLIC_KEYS')
  })
})

describe('清单规范化与交叉测试向量', () => {
  const vector = JSON.parse(readFileSync(new URL('./fixtures/yunsun-hot-update-vector.json', import.meta.url), 'utf8')) as {
    publicKeys: Record<string, string>
    manifest: Record<string, unknown>
    canonical: string
    signature: string
  }

  it('规范化结果等于向量的 canonical，且签名用公钥验证通过', () => {
    const manifest = parseManifest(vector.manifest)
    expect(canonicalManifestBytes(manifest).toString('utf8')).toBe(vector.canonical)
    const publicKey = createPublicKey(vector.publicKeys[manifest.keyId] as string)
    expect(verify(null, canonicalManifestBytes(manifest), publicKey, Buffer.from(vector.signature, 'base64'))).toBe(true)
  })

  it.each([
    ['缺字段', (m: Record<string, unknown>) => { delete m.keyId }],
    ['有未知字段', (m: Record<string, unknown>) => { m.extra = 1 }],
    ['file 与 version 不符', (m: Record<string, unknown>) => { m.file = 'yunsun-dsh-edu-other.tgz' }],
    ['version 不是 build 格式', (m: Record<string, unknown>) => { m.version = '1.0.0'; m.file = 'yunsun-dsh-edu-1.0.0.tgz' }],
    ['expiresAt 格式不对', (m: Record<string, unknown>) => { m.expiresAt = '2026-12-22T08:00:00Z' }],
  ])('坏清单：%s', (_name, mutate) => {
    const manifest = { ...vector.manifest }
    mutate(manifest)
    expect(() => parseManifest(manifest)).toThrow('manifest:')
  })

  it('staged 清单多一个字段：整个 staged 目录被丢弃', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', '0.0.0-build.20251201000000')
    const staged = writeStaged(dir, key, '0.0.0-build.20260201000000')
    const path = join(staged, 'manifest.json')
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')) as object, extra: 1 }))
    await run(dir, resources(root, { hotUpdate }))
    expect(existsSync(staged)).toBe(false)
  })
})

describe('启动选包规则', () => {
  const NEWER = '0.0.0-build.20260201000000'
  const OLDER = '0.0.0-build.20251201000000'

  it('staged 更新于自带包：安装 staged，tgz 复制进 yunsun-packages，startup.json 带 previousFile', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', BUNDLED)
    mkdirSync(join(dir, 'yunsun-packages'), { recursive: true })
    writeFileSync(join(dir, 'yunsun-packages', `yunsun-dsh-edu-${BUNDLED}.tgz`), 'old')
    writeStaged(dir, key, NEWER)
    const calls: { args: readonly string[]; cwd: string }[] = []
    expect(await run(dir, resources(root, { hotUpdate }), calls)).toBe('installed')
    expect(installedVersion(dir)).toBe(NEWER)
    expect(existsSync(join(dir, 'yunsun-packages', `yunsun-dsh-edu-${NEWER}.tgz`))).toBe(true)
    expect(calls[0]?.args[1]).toBe(`./yunsun-packages/yunsun-dsh-edu-${NEWER}.tgz`)
    expect(startup(dir)).toMatchObject({ version: NEWER, previousFile: `yunsun-dsh-edu-${BUNDLED}.tgz` })
    // 状态文件仍然只记自带版本
    expect(JSON.parse(readFileSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE), 'utf8'))).toMatchObject({ version: BUNDLED })
  })

  it('自带包比已装版本新：安装自带包并写 startup.json', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    expect(await run(dir, resources(root, { hotUpdate }))).toBe('installed')
    expect(installedVersion(dir)).toBe(BUNDLED)
    expect(startup(dir)).toMatchObject({ version: BUNDLED })
  })

  it('已装版本更新于自带包和 staged：不动，也不写 startup.json', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', '0.0.0-build.20260301000000')
    writeStaged(dir, key, NEWER)
    const calls: { args: readonly string[]; cwd: string }[] = []
    expect(await run(dir, resources(root, { hotUpdate }), calls)).toBe('current')
    expect(calls).toHaveLength(0)
    expect(startup(dir)).toBeUndefined()
    expect(existsSync(join(dir, 'yunsun-updates', 'staged', NEWER))).toBe(true)
  })

  it('已装版本等于自带版本：不动', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', BUNDLED)
    const calls: { args: readonly string[]; cwd: string }[] = []
    expect(await run(dir, resources(root, { hotUpdate }), calls)).toBe('current')
    expect(calls).toHaveLength(0)
  })

  it('黑名单里的 staged 版本被排除，自带包仍可安装', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    writeStaged(dir, key, NEWER)
    writeFileSync(join(dir, 'yunsun-updates', 'blacklist.json'), JSON.stringify({ versions: [NEWER] }))
    await run(dir, resources(root, { hotUpdate }))
    expect(installedVersion(dir)).toBe(BUNDLED)
  })

  it('黑名单里的自带版本：已有可用已装版本时不装；没有已装版本时仍装并记日志', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    writeFileSync(join(dir, 'x'), '')
    mkdirSync(join(dir, 'yunsun-updates'), { recursive: true })
    writeFileSync(join(dir, 'yunsun-updates', 'blacklist.json'), JSON.stringify({ versions: [BUNDLED] }))
    const errors: string[] = []
    await run(dir, resources(root, { hotUpdate }), [], { info: () => undefined, error: (message: string) => errors.push(message) })
    expect(installedVersion(dir)).toBe(BUNDLED)
    expect(errors.join('\n')).toContain('黑名单')
    const dir2 = profile(temporaryRoot())
    installedPackage(dir2, '@yunsun/dsh-edu', OLDER)
    mkdirSync(join(dir2, 'yunsun-updates'), { recursive: true })
    writeFileSync(join(dir2, 'yunsun-updates', 'blacklist.json'), JSON.stringify({ versions: [BUNDLED] }))
    expect(await run(dir2, resources(temporaryRoot(), { hotUpdate }))).toBe('current')
    expect(installedVersion(dir2)).toBe(OLDER)
  })

  it('已装版本 engines.dsh 不符视为无效：重新装候选', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', '0.0.0-build.20260301000000', '9.9.9')
    expect(await run(dir, resources(root, { hotUpdate }))).toBe('installed')
    expect(installedVersion(dir)).toBe(BUNDLED)
  })

  it.each([
    ['签名密钥不对', { signWith: makeKey('k1') }],
    ['sha256 不符', { tamperSha: true }],
    ['size 不符', { tamperSize: true }],
    ['dshVersion 不符', { dshVersion: '0.9.9' }],
  ])('坏的 staged（%s）：删除目录、不阻断启动、改装自带包', async (_name, options) => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    const staged = writeStaged(dir, key, NEWER, options)
    const errors: string[] = []
    await run(dir, resources(root, { hotUpdate }), [], { info: () => undefined, error: (message: string) => errors.push(message) })
    expect(existsSync(staged)).toBe(false)
    expect(installedVersion(dir)).toBe(BUNDLED)
    expect(errors.join('\n')).toContain(NEWER)
  })

  it('没有 .ok 的 staged 不使用也不删除', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    const staged = writeStaged(dir, key, NEWER, { ok: false })
    await run(dir, resources(root, { hotUpdate }))
    expect(installedVersion(dir)).toBe(BUNDLED)
    expect(existsSync(staged)).toBe(true)
  })

  it('staged 安装失败：丢弃它，继续装自带包', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    writeStaged(dir, key, NEWER)
    const pnpm = fakePnpm()
    const runPnpm = (args: readonly string[], cwd: string): Promise<void> =>
      args[1]?.includes(NEWER) === true ? Promise.reject(new Error('boom')) : pnpm(args, cwd)
    const res = resources(root, { hotUpdate })
    await preinstallYunsunBundle({ profileDir: dir, resources: res, runPnpm, dshVersion: DSH_VERSION, log: silent })
    expect(installedVersion(dir)).toBe(BUNDLED)
    expect(existsSync(join(dir, 'yunsun-updates', 'staged', NEWER))).toBe(false)
  })

  it('没有 hotUpdate 配置时完全忽略 staged', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    installedPackage(dir, '@yunsun/dsh-edu', OLDER)
    writeStaged(dir, key, NEWER)
    await run(dir, resources(root))
    expect(installedVersion(dir)).toBe(BUNDLED)
  })

  it('更新器 bundle：按自带版本预装并登记；版本没变不重装；旧状态文件兼容', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    // 旧格式状态文件：只有 bundle 和 version
    writeFileSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE), JSON.stringify({ bundle: '@yunsun/dsh-edu', version: BUNDLED }))
    installedPackage(dir, '@yunsun/dsh-edu', BUNDLED)
    const calls: { args: readonly string[]; cwd: string }[] = []
    const res = resources(root, { updaterBundle: updaterRef, hotUpdate })
    expect(await run(dir, res, calls)).toBe('current')
    expect(calls.map(call => call.args[1])).toEqual([`./yunsun-packages/${updaterRef.file}`])
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    // 已装但没登记的教育 bundle 同时被补登记（见下一条用例）
    expect(manifest.dsh.profile.bundles).toEqual(['@yunsun/dsh-edu', '@yunsun/dsh-edu-updater'])
    expect(JSON.parse(readFileSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE), 'utf8'))).toEqual({
      bundle: '@yunsun/dsh-edu', version: BUNDLED, updater: { name: updaterRef.name, version: updaterRef.version },
    })
    await run(dir, res, calls)
    expect(calls).toHaveLength(1)
  })

  it('已装但不在 dsh.profile.bundles 里（热更新停用后被杀）：补登记两个 bundle 并记日志，不重装', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    const res = resources(root, { updaterBundle: updaterRef, hotUpdate })
    const calls: { args: readonly string[]; cwd: string }[] = []
    await run(dir, res, calls)
    const manifestPath = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, dsh: { profile: { bundles: [] } } }))
    const errors: string[] = []
    calls.length = 0
    expect(await run(dir, res, calls, { info: () => undefined, error: (message: string) => { errors.push(message) } })).toBe('current')
    expect(calls).toHaveLength(0)
    const healed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(healed.dsh.profile.bundles).toEqual(['@yunsun/dsh-edu', '@yunsun/dsh-edu-updater'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/重新登记/)
  })

  it('更新器安装失败只记日志，教育 bundle 结果不受影响', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    const pnpm = fakePnpm()
    const runPnpm = (args: readonly string[], cwd: string): Promise<void> =>
      args[1]?.includes('updater') === true ? Promise.reject(new Error('updater boom')) : pnpm(args, cwd)
    const errors: string[] = []
    const result = await preinstallYunsunBundle({
      profileDir: dir, resources: resources(root, { updaterBundle: updaterRef, hotUpdate }), runPnpm, dshVersion: DSH_VERSION,
      log: { info: () => undefined, error: message => errors.push(message) },
    })
    expect(result).toBe('installed')
    expect(errors.join('\n')).toContain('updater boom')
    expect(JSON.parse(readFileSync(join(dir, YUNSUN_PREINSTALL_STATE_FILE), 'utf8'))).not.toHaveProperty('updater')
  })

  it('传入 dshHome 时写 home 层补丁', async () => {
    const root = temporaryRoot()
    const dir = profile(root)
    const home = join(root, 'home')
    mkdirSync(home)
    await preinstallYunsunBundle({
      profileDir: dir, resources: resources(root), runPnpm: fakePnpm(), dshVersion: DSH_VERSION, dshHome: home, log: silent,
    })
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toContain('id: session-log-deepseek')
  })
})

describe('home 层补丁', () => {
  function home(): string {
    const dir = temporaryRoot()
    return dir
  }
  function patchPath(dir: string): string { return join(dir, 'cordis.patch.yml') }

  it('不存在时新建：带标记、每个 id 一行 disabled: true', () => {
    const dir = home()
    expect(ensureYunsunHomePatch(dir)).toBe('created')
    const text = readFileSync(patchPath(dir), 'utf8')
    expect(text.split('\n', 1)[0]).toBe(YUNSUN_HOME_PATCH_MARKER)
    for (const id of YUNSUN_HOME_PATCH_DISABLED_IDS) expect(text).toContain(`- id: ${id}\n  disabled: true\n`)
    expect(YUNSUN_HOME_PATCH_DISABLED_IDS).toHaveLength(6)
  })

  it('幂等：再次运行不改内容', () => {
    const dir = home()
    ensureYunsunHomePatch(dir)
    const before = readFileSync(patchPath(dir), 'utf8')
    expect(ensureYunsunHomePatch(dir)).toBe('unchanged')
    expect(readFileSync(patchPath(dir), 'utf8')).toBe(before)
  })

  it('覆盖自己写的旧内容', () => {
    const dir = home()
    writeFileSync(patchPath(dir), `${YUNSUN_HOME_PATCH_MARKER}\n- id: session-log-deepseek\n  disabled: true\n`)
    expect(ensureYunsunHomePatch(dir)).toBe('updated')
    expect(readFileSync(patchPath(dir), 'utf8')).toContain('ui-settings-account')
  })

  it('用户文件：保留原内容，只追加缺的行', () => {
    const dir = home()
    const mine = '# 我的设置\n- id: tool-bash\n  disabled: true\n- id: session-log-deepseek\n  disabled: true'
    writeFileSync(patchPath(dir), mine)
    expect(ensureYunsunHomePatch(dir)).toBe('merged')
    const text = readFileSync(patchPath(dir), 'utf8')
    expect(text.startsWith(mine)).toBe(true)
    expect(text.match(/id: session-log-deepseek/gu)).toHaveLength(1)
    for (const id of YUNSUN_HOME_PATCH_DISABLED_IDS) expect(text).toContain(`id: ${id}`)
    expect(ensureYunsunHomePatch(dir)).toBe('unchanged')
  })

  it('用户文件已包含全部 id 时不动', () => {
    const dir = home()
    const text = YUNSUN_HOME_PATCH_DISABLED_IDS.map(id => `- id: ${id}\n  disabled: true\n`).join('')
    writeFileSync(patchPath(dir), text)
    expect(ensureYunsunHomePatch(dir)).toBe('unchanged')
    expect(readFileSync(patchPath(dir), 'utf8')).toBe(text)
  })

  it('空文件或只有注释的用户文件可以合并', () => {
    const dir = home()
    writeFileSync(patchPath(dir), '# 只有注释\n')
    expect(ensureYunsunHomePatch(dir)).toBe('merged')
    expect(readFileSync(patchPath(dir), 'utf8')).toContain('# 只有注释')
  })

  it('无法安全合并时抛错且不改文件：id 已存在但没禁用、根不是列表、YAML 不合法', () => {
    const cases = [
      ['- id: session-log-deepseek\n  disabled: false\n', 'disabled: true'],
      ['key: value\n', '根节点不是列表'],
      ['- id: [unclosed\n', '不是用户可安全合并的 YAML'],
      ['[]\n', '无法在末尾安全追加'],
    ] as const
    for (const [content, message] of cases) {
      const dir = home()
      writeFileSync(patchPath(dir), content)
      expect(() => ensureYunsunHomePatch(dir)).toThrow(message)
      expect(readFileSync(patchPath(dir), 'utf8')).toBe(content)
    }
  })
})
