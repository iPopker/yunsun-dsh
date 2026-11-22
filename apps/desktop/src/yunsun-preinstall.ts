/**
 * [yunsun] P4 预装 bundle 和打包期配置（见 edu-agent 的 docs/decisions/0035-packaging-and-preinstall.md）。
 *
 * 打包时 edu-agent 的 `node packages/dsh-edu/scripts/pack-yunsun-resources.mjs` 产出 `<resources>/yunsun/`：
 *   yunsun.json                打包期配置（服务端地址、bundle 文件名和版本）；它的存在就是「云隼智教构建」的标记
 *   <bundle>.tgz               自包含的 @yunsun/dsh-edu（所有 @yunsun/* 插件和第三方依赖都在 bundledDependencies 里）
 * 运行时：
 *   1. 主进程最先执行 yunsun-packaged-init.ts，把标记换成环境变量（DSH_PRODUCT_BRAND、YUNSUN_SERVER_URL），
 *      Host 子进程继承它们；用户或开发者自己设置的环境变量优先。
 *      同时把 DSH_HOME 指到 `~/.yunsun-edu`，会话、凭据、profile 都和上游 DeepSeek Harness 的 `~/.dsh` 分开，两个应用可以并存。
 *   2. 创建 desktop profile 之后，用内置 pnpm 离线 `pnpm add` 这个 tgz，并把它登记进 `dsh.profile.bundles`。
 *      启动选包（ADR 0043）：自带包和更新器已下载验签的 staged 版本里取 semver 最大者，和已装版本比较，
 *      只升不降；用户之后用插件管理器装第三方插件走原来的路径，不受影响。
 *   3. 可选的更新器 bundle（热更新，ADR 0043）单独预装；home 层补丁 `$DSH_HOME/cordis.patch.yml` 关掉上游上报行。
 * 没有标记（上游构建、开发版）时这里的所有函数都不做事，上游测试不变。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { compare, satisfies, valid } from 'semver'
import { ensureYunsunHomePatch } from './yunsun-hot-update-home-patch.ts'
import { parseHotUpdateConfig, verifyStagedPackage, type VerifiedStagedPackage, type YunsunHotUpdateConfig } from './yunsun-hot-update-manifest.ts'

/** 资源目录名（相对 process.resourcesPath）。 */
export const YUNSUN_RESOURCE_DIR = 'yunsun'
/** [yunsun] 云隼智教构建的运行时数据目录名（位于用户 home 下），避免和上游共用 `~/.dsh`。 */
export const YUNSUN_DSH_HOME_DIR_NAME = '.yunsun-edu'
/** [yunsun] 云隼智教构建的 Electron userData 目录名（位于系统 appData 下），避免和上游共用单实例锁和本机偏好。 */
export const YUNSUN_USER_DATA_DIR_NAME = 'yunsun-edu'
/** 打包期配置文件名；存在即表示这是云隼智教构建。 */
export const YUNSUN_CONFIG_FILE = 'yunsun.json'
/** 预装的 bundle 包名。 */
export const YUNSUN_BUNDLE_NAME = '@yunsun/dsh-edu'
/** 更新器 bundle 的包名。 */
export const YUNSUN_UPDATER_BUNDLE_NAME = '@yunsun/dsh-edu-updater'
/** profile 内保存预装状态的文件：记录「自带包已处理到哪个版本」，热更新永远不写它。 */
export const YUNSUN_PREINSTALL_STATE_FILE = 'yunsun-preinstall.json'
const PACKAGES_DIR = 'yunsun-packages'
const TARBALL = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u

/** 打包期写入 `yunsun.json` 的配置。 */
export interface YunsunPackagedConfig {
  readonly schemaVersion: 1
  /** 云隼服务端地址，运行时变成 YUNSUN_SERVER_URL（环境变量优先）。 */
  readonly serverBaseUrl: string
  readonly bundle: YunsunBundleRef
  /** 可选：更新器 bundle，随安装包预装，不参与热更新。 */
  readonly updaterBundle?: YunsunBundleRef
  /** 可选：热更新源和验签公钥；缺省时不启用热更新。 */
  readonly hotUpdate?: YunsunHotUpdateConfig
}

export interface YunsunBundleRef { readonly name: string; readonly version: string; readonly file: string }

type Env = Record<string, string | undefined>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验并规范化打包期配置；任何字段不合法都抛出带字段名的错误，不用默认值悄悄补。
 * @param value - 解析后的 JSON。
 */
export function parseYunsunPackagedConfig(value: unknown): YunsunPackagedConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('yunsun.json: schemaVersion 必须是 1')
  const server = value.serverBaseUrl
  if (typeof server !== 'string') throw new Error('yunsun.json: serverBaseUrl 必须是字符串')
  let protocol: string
  try { protocol = new URL(server).protocol } catch { throw new Error('yunsun.json: serverBaseUrl 不是合法 URL') }
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`yunsun.json: serverBaseUrl 必须是 http/https，收到 ${protocol}`)
  const bundle = value.bundle
  if (!isRecord(bundle) || bundle.name !== YUNSUN_BUNDLE_NAME
    || typeof bundle.version !== 'string' || bundle.version === ''
    || typeof bundle.file !== 'string' || !TARBALL.test(bundle.file)) {
    throw new Error(`yunsun.json: bundle 必须是 { name: "${YUNSUN_BUNDLE_NAME}", version, file: "*.tgz" }`)
  }
  const updaterBundle = value.updaterBundle === undefined ? undefined : parseUpdaterBundle(value.updaterBundle)
  const hotUpdate = value.hotUpdate === undefined ? undefined : parseHotUpdateConfig(value.hotUpdate)
  return {
    schemaVersion: 1, serverBaseUrl: server, bundle: { name: bundle.name, version: bundle.version, file: bundle.file },
    ...updaterBundle === undefined ? {} : { updaterBundle },
    ...hotUpdate === undefined ? {} : { hotUpdate },
  }
}

function parseUpdaterBundle(value: unknown): YunsunBundleRef {
  if (!isRecord(value) || value.name !== YUNSUN_UPDATER_BUNDLE_NAME
    || typeof value.version !== 'string' || value.version === ''
    || typeof value.file !== 'string' || !TARBALL.test(value.file)) {
    throw new Error(`yunsun.json: updaterBundle 必须是 { name: "${YUNSUN_UPDATER_BUNDLE_NAME}", version, file: "*.tgz" }`)
  }
  return { name: value.name, version: value.version, file: value.file }
}

/** 打包后的应用里找到的云隼资源。 */
export interface YunsunPackagedResources {
  readonly dir: string
  readonly config: YunsunPackagedConfig
}

/**
 * 读取 `<resources>/yunsun/yunsun.json`。文件不存在返回 undefined（不是云隼构建）；存在但不合法就抛出。
 * @param resourcesPath - Electron 的 process.resourcesPath；开发版没有这个目录，传 undefined。
 */
export function readYunsunPackagedResources(resourcesPath: string | undefined): YunsunPackagedResources | undefined {
  if (resourcesPath === undefined) return undefined
  const dir = join(resourcesPath, YUNSUN_RESOURCE_DIR)
  const file = join(dir, YUNSUN_CONFIG_FILE)
  if (!existsSync(file)) return undefined
  const config = parseYunsunPackagedConfig(JSON.parse(readFileSync(file, 'utf8')))
  if (!existsSync(join(dir, config.bundle.file))) throw new Error(`yunsun resources: 缺少 bundle 文件 ${config.bundle.file}`)
  const updater = config.updaterBundle
  if (updater !== undefined && !existsSync(join(dir, updater.file))) throw new Error(`yunsun resources: 缺少更新器 bundle 文件 ${updater.file}`)
  return { dir, config }
}

/**
 * 把打包期配置变成环境变量。已有的值不覆盖，所以开发者和企业部署仍可用环境变量改。
 * 遥测开关和 `pnpm dev:dsh` 保持一致。
 * [yunsun] DSH_HOME 默认 `~/.yunsun-edu`，与上游的 `~/.dsh` 隔离；用户已设的 DSH_HOME 优先。
 * @param env - 要补齐的环境对象（通常是 process.env）。
 * @param resources - 已读取并校验的打包期资源。
 */
export function applyYunsunPackagedEnv(env: Env, resources: YunsunPackagedResources): void {
  env.DSH_PRODUCT_BRAND ??= 'yunsun'
  env.YUNSUN_SERVER_URL ??= resources.config.serverBaseUrl
  env.DSH_HOME ??= join(homedir(), YUNSUN_DSH_HOME_DIR_NAME)
  env.DSH_TELEMETRY_DISABLED ??= '1'
  env.DSH_TELEMETRY_MODE ??= 'DISABLED'
  // [yunsun] 热更新：更新器插件的 cordis.patch.yml 用 !!js process.env.… 读这两个值。
  const { hotUpdate } = resources.config
  if (hotUpdate !== undefined) {
    env.YUNSUN_HOT_UPDATE_FEED_URL ??= hotUpdate.feedUrl
    env.YUNSUN_HOT_UPDATE_PUBLIC_KEYS ??= JSON.stringify(hotUpdate.publicKeys)
  }
}

/** 在 profile 目录里执行内置 pnpm；由主进程实现，测试里可替换。 */
export type RunPnpm = (args: readonly string[], cwd: string) => Promise<void>

/** 预装状态；旧文件只有 bundle 和 version，updater 是后来加的可选字段。 */
interface PreinstallState {
  readonly bundle: string
  readonly version: string
  readonly updater?: { readonly name: string; readonly version: string }
}

function readState(path: string): PreinstallState | undefined {
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value) || typeof value.bundle !== 'string' || typeof value.version !== 'string') {
    throw new Error(`${YUNSUN_PREINSTALL_STATE_FILE}: 格式不对，删除后重启会重新预装`)
  }
  const updater = value.updater
  if (updater === undefined) return { bundle: value.bundle, version: value.version }
  if (!isRecord(updater) || typeof updater.name !== 'string' || typeof updater.version !== 'string') {
    throw new Error(`${YUNSUN_PREINSTALL_STATE_FILE}: updater 字段格式不对，删除后重启会重新预装`)
  }
  return { bundle: value.bundle, version: value.version, updater: { name: updater.name, version: updater.version } }
}

function writeState(path: string, state: PreinstallState): void {
  writeFileSync(path, `${JSON.stringify(state, undefined, 2)}\n`)
}

/** 把 bundle 登记进 `dsh.profile.bundles`；已登记时不写文件。@returns 本次是否补登记。 */
function registerBundle(manifestPath: string, name: string): boolean {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!isRecord(manifest)) throw new Error('profile package.json 不是对象')
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : {}
  const profile = isRecord(dsh.profile) ? dsh.profile : {}
  const bundles = Array.isArray(profile.bundles) ? profile.bundles.filter((entry): entry is string => typeof entry === 'string') : []
  if (bundles.includes(name)) return false
  bundles.push(name)
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, dsh: { ...dsh, profile: { ...profile, bundles } } }, undefined, 2)}\n`)
  return true
}

/**
 * 已装但没登记时补登记。热更新在「停用 bundle」和「启用 bundle」之间被杀会留下这种状态：
 * 依赖还在，`dsh.profile.bundles` 里却没有它，重启后整个教育插件不加载（ADR 0043 3a 实测）。
 */
function healRegistration(profileDir: string, name: string, log: PreinstallLog): void {
  if (!existsSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))) return
  if (registerBundle(join(profileDir, 'package.json'), name)) {
    log.error(`yunsun preinstall: ${name} 已安装但不在 dsh.profile.bundles 里（多半是热更新中途被中断），已重新登记`)
  }
}

/** 已装版本；没装、版本不是 semver、或 engines.dsh 与当前 dsh 不符都返回 undefined（视为没装）。 */
function readInstalledVersion(profileDir: string, name: string, dshVersion: string): string | undefined {
  const path = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(path)) return undefined
  let manifest: unknown
  try { manifest = JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
  if (!isRecord(manifest) || typeof manifest.version !== 'string' || valid(manifest.version) === null) return undefined
  const engines = isRecord(manifest.engines) ? manifest.engines.dsh : undefined
  if (typeof engines !== 'string' || !satisfies(dshVersion, engines, { includePrerelease: true })) return undefined
  return manifest.version
}

function readBlacklist(updatesDir: string, log: PreinstallLog): ReadonlySet<string> | undefined {
  const path = join(updatesDir, 'blacklist.json')
  if (!existsSync(path)) return new Set()
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(value) || !Array.isArray(value.versions) || value.versions.some(item => typeof item !== 'string')) throw new Error('格式应为 { versions: string[] }')
    return new Set(value.versions as string[])
  } catch (error) {
    log.error(`yunsun preinstall: 黑名单 ${path} 不可读（${(error as Error).message}），本次启动忽略所有 staged 版本`)
    return undefined
  }
}

interface PreinstallLog {
  readonly info: (message: string) => void
  readonly error: (message: string) => void
}

interface Candidate {
  readonly version: string
  /** 自带包为 undefined；staged 版本是验过的包。 */
  readonly staged?: { readonly dir: string; readonly verified: VerifiedStagedPackage }
}

/**
 * 找出值得安装的 staged 版本：版本高于 `threshold`、不在黑名单、带 .ok，且重新验证通过，按版本从高到低。
 * 验证失败的目录删除并记日志，不阻断启动；没有 .ok 的目录（可能还在下载）不碰。
 */
async function stagedCandidates(options: {
  readonly updatesDir: string
  readonly threshold: string | undefined
  readonly blacklist: ReadonlySet<string>
  readonly hotUpdate: YunsunHotUpdateConfig
  readonly dshVersion: string
  readonly log: PreinstallLog
}): Promise<Candidate[]> {
  const stagedDir = join(options.updatesDir, 'staged')
  if (!existsSync(stagedDir)) return []
  const names = readdirSync(stagedDir).filter(name => valid(name) !== null && !options.blacklist.has(name)
    && (options.threshold === undefined || compare(name, options.threshold) > 0)
    && existsSync(join(stagedDir, name, '.ok')))
  names.sort((left, right) => compare(right, left))
  const result: Candidate[] = []
  for (const version of names) {
    const dir = join(stagedDir, version)
    try {
      const verified = await verifyStagedPackage({
        dir, version, bundleName: YUNSUN_BUNDLE_NAME, dshVersion: options.dshVersion, publicKeys: options.hotUpdate.publicKeys,
      })
      result.push({ version, staged: { dir, verified } })
    } catch (error) {
      options.log.error(`yunsun preinstall: 丢弃 staged ${version}：${(error as Error).message}`)
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return result
}

async function installTarball(options: {
  readonly profileDir: string
  readonly name: string
  readonly source: string
  readonly file: string
  readonly runPnpm: RunPnpm
}): Promise<void> {
  const { profileDir, name, source, file, runPnpm } = options
  mkdirSync(join(profileDir, PACKAGES_DIR), { recursive: true })
  copyFileSync(source, join(profileDir, PACKAGES_DIR, file))
  await runPnpm(['add', `./${PACKAGES_DIR}/${file}`, '--offline', '--ignore-scripts'], profileDir)
  registerBundle(join(profileDir, 'package.json'), name)
}

/** 安装前已装版本的 tgz 文件名（约定 `yunsun-dsh-edu-<version>.tgz`）；不在 yunsun-packages 里则为 null。 */
function previousTarball(profileDir: string, installed: string | undefined): string | null {
  if (installed === undefined) return null
  const file = `yunsun-dsh-edu-${installed}.tgz`
  return existsSync(join(profileDir, PACKAGES_DIR, file)) ? file : null
}

function writeStartup(updatesDir: string, version: string, previousFile: string | null): void {
  mkdirSync(updatesDir, { recursive: true })
  writeFileSync(join(updatesDir, 'startup.json'), `${JSON.stringify({ version, previousFile, at: new Date().toISOString() }, undefined, 2)}\n`)
}

async function preinstallEducationBundle(options: {
  readonly profileDir: string
  readonly resources: YunsunPackagedResources
  readonly dshVersion: string
  readonly runPnpm: RunPnpm
  readonly log: PreinstallLog
}): Promise<'installed' | 'current'> {
  const { profileDir, resources, dshVersion, runPnpm, log } = options
  const { bundle, hotUpdate } = resources.config
  const updatesDir = join(profileDir, 'yunsun-updates')
  const installed = readInstalledVersion(profileDir, bundle.name, dshVersion)
  const blacklist = hotUpdate === undefined ? new Set<string>() : readBlacklist(updatesDir, log)
  // 黑名单损坏时只用自带包。自带包被拉黑但当前没有可用的已装版本时仍然安装它：没有教育插件应用不能用。
  const bundledBlocked = blacklist?.has(bundle.version) === true && installed !== undefined
  const bundled: Candidate | undefined = bundledBlocked ? undefined : { version: bundle.version }
  if (blacklist?.has(bundle.version) === true && installed === undefined) {
    log.error(`yunsun preinstall: 自带版本 ${bundle.version} 在黑名单里，但没有可用的已装版本，仍安装自带包`)
  }
  const floors = [installed, bundled?.version].filter((v): v is string => v !== undefined)
  const threshold = floors.length === 0 ? undefined : floors.reduce((a, b) => (compare(a, b) >= 0 ? a : b))
  const staged = hotUpdate === undefined || blacklist === undefined
    ? []
    : await stagedCandidates({ updatesDir, threshold, blacklist, hotUpdate, dshVersion, log })
  const ranked = [...staged, ...bundled === undefined ? [] : [bundled]]
  for (const candidate of ranked) {
    if (installed !== undefined && compare(candidate.version, installed) <= 0) break
    const previousFile = previousTarball(profileDir, installed)
    if (candidate.staged === undefined) {
      await installTarball({ profileDir, name: bundle.name, source: join(resources.dir, bundle.file), file: bundle.file, runPnpm })
    } else {
      const { verified, dir } = candidate.staged
      try {
        await installTarball({ profileDir, name: bundle.name, source: verified.tarballPath, file: verified.manifest.file, runPnpm })
      } catch (error) {
        log.error(`yunsun preinstall: staged ${candidate.version} 安装失败，丢弃并尝试下一个：${(error as Error).message}`)
        rmSync(dir, { recursive: true, force: true })
        continue
      }
    }
    writeStartup(updatesDir, candidate.version, previousFile)
    log.info(`yunsun preinstall: 已安装 ${candidate.staged === undefined ? '自带' : 'staged'} ${candidate.version}（原 ${installed ?? '无'}）`)
    return 'installed'
  }
  return 'current'
}

/**
 * 把打包进应用的 bundle 离线安装进 desktop profile。必须在 profile 已创建、且持有 profile 锁时调用。
 * 启动选包规则见 ADR 0043：自带包和已验签的 staged 版本中取 semver 最大者，只在高于已装版本时安装；
 * 自带包安装失败直接抛出（没有教育插件的云隼智教没法用，不能静默继续），staged 版本失败只记日志。
 * 同时写 home 层补丁，并按自带版本预装更新器 bundle（更新器失败只记日志，不阻断启动）。
 * @param options.dshVersion - 当前内置 dsh 版本（`readDesktopRuntime(runtime.dsh).release.version`，与 `@deepseek-ai/dsh` 同版本）。
 * @param options.dshHome - DSH_HOME；传入时写 `<dshHome>/cordis.patch.yml`。
 * @returns 'installed' 本次装了教育 bundle，'current' 不需要装。
 */
export async function preinstallYunsunBundle(options: {
  readonly profileDir: string
  readonly resources: YunsunPackagedResources
  readonly runPnpm: RunPnpm
  readonly dshVersion: string
  readonly dshHome?: string
  readonly log?: PreinstallLog
}): Promise<'installed' | 'current'> {
  const { profileDir, resources, runPnpm, dshVersion } = options
  const log = options.log ?? {
    info: (message: string) => { console.info(message) },
    error: (message: string) => { console.error(message) },
  }
  const { bundle, updaterBundle } = resources.config
  const statePath = join(profileDir, YUNSUN_PREINSTALL_STATE_FILE)
  if (options.dshHome !== undefined) log.info(`yunsun preinstall: home patch ${ensureYunsunHomePatch(options.dshHome)}`)
  const result = await preinstallEducationBundle({ profileDir, resources, dshVersion, runPnpm, log })
  if (result === 'current') healRegistration(profileDir, bundle.name, log)
  // 状态文件只记「自带包已处理到哪个版本」：不管本次装的是自带包还是更新的 staged 版本，都不写 staged 版本号。
  let state = readState(statePath)
  if (state?.bundle !== bundle.name || state.version !== bundle.version) {
    state = { ...state?.updater === undefined ? {} : { updater: state.updater }, bundle: bundle.name, version: bundle.version }
    writeState(statePath, state)
  }
  if (updaterBundle !== undefined && !(state.updater?.name === updaterBundle.name && state.updater.version === updaterBundle.version)) {
    try {
      await installTarball({
        profileDir, name: updaterBundle.name, source: join(resources.dir, updaterBundle.file), file: updaterBundle.file, runPnpm,
      })
      writeState(statePath, { ...state, updater: { name: updaterBundle.name, version: updaterBundle.version } })
      log.info(`yunsun preinstall: 更新器 ${updaterBundle.version} 已安装`)
    } catch (error) {
      log.error(`yunsun preinstall: 更新器 bundle 安装失败，本次启动没有热更新，下次启动重试：${(error as Error).message}`)
    }
  } else if (updaterBundle !== undefined) {
    healRegistration(profileDir, updaterBundle.name, log)
  }
  return result
}
