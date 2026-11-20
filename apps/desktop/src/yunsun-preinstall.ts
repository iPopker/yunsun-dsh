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
 *      版本没变就跳过；用户之后用插件管理器装第三方插件走原来的路径，不受影响。
 * 没有标记（上游构建、开发版）时这里的所有函数都不做事，上游测试不变。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
/** profile 内保存预装状态的文件。 */
export const YUNSUN_PREINSTALL_STATE_FILE = 'yunsun-preinstall.json'
const PACKAGES_DIR = 'yunsun-packages'
const TARBALL = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u

/** 打包期写入 `yunsun.json` 的配置。 */
export interface YunsunPackagedConfig {
  readonly schemaVersion: 1
  /** 云隼服务端地址，运行时变成 YUNSUN_SERVER_URL（环境变量优先）。 */
  readonly serverBaseUrl: string
  readonly bundle: { readonly name: string; readonly version: string; readonly file: string }
}

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
  return { schemaVersion: 1, serverBaseUrl: server, bundle: { name: bundle.name, version: bundle.version, file: bundle.file } }
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
}

/** 在 profile 目录里执行内置 pnpm；由主进程实现，测试里可替换。 */
export type RunPnpm = (args: readonly string[], cwd: string) => Promise<void>

interface PreinstallState {
  readonly bundle: string
  readonly version: string
}

function readState(path: string): PreinstallState | undefined {
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value) || typeof value.bundle !== 'string' || typeof value.version !== 'string') {
    throw new Error(`${YUNSUN_PREINSTALL_STATE_FILE}: 格式不对，删除后重启会重新预装`)
  }
  return { bundle: value.bundle, version: value.version }
}

function registerBundle(manifestPath: string, name: string): void {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!isRecord(manifest)) throw new Error('profile package.json 不是对象')
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : {}
  const profile = isRecord(dsh.profile) ? dsh.profile : {}
  const bundles = Array.isArray(profile.bundles) ? profile.bundles.filter((entry): entry is string => typeof entry === 'string') : []
  if (!bundles.includes(name)) bundles.push(name)
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, dsh: { ...dsh, profile: { ...profile, bundles } } }, undefined, 2)}\n`)
}

/**
 * 把打包进应用的 bundle 离线安装进 desktop profile。必须在 profile 已创建、且持有 profile 锁时调用。
 * 版本和上次相同时不做事；安装失败直接抛出（没有教育插件的云隼智教没法用，不能静默继续）。
 * @returns 'installed' 本次装了，'current' 已是最新。
 */
export async function preinstallYunsunBundle(options: {
  readonly profileDir: string
  readonly resources: YunsunPackagedResources
  readonly runPnpm: RunPnpm
}): Promise<'installed' | 'current'> {
  const { profileDir, resources, runPnpm } = options
  const { bundle } = resources.config
  const statePath = join(profileDir, YUNSUN_PREINSTALL_STATE_FILE)
  const state = readState(statePath)
  if (state?.bundle === bundle.name && state.version === bundle.version) return 'current'
  mkdirSync(join(profileDir, PACKAGES_DIR), { recursive: true })
  copyFileSync(join(resources.dir, bundle.file), join(profileDir, PACKAGES_DIR, bundle.file))
  await runPnpm(['add', `./${PACKAGES_DIR}/${bundle.file}`, '--offline', '--ignore-scripts'], profileDir)
  registerBundle(join(profileDir, 'package.json'), bundle.name)
  writeFileSync(statePath, `${JSON.stringify({ bundle: bundle.name, version: bundle.version }, undefined, 2)}\n`)
  return 'installed'
}
