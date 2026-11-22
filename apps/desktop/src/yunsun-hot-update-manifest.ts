/**
 * [yunsun] P4 教育插件热更新的公共部分：`yunsun.json.hotUpdate` 解析，以及 staged 目录里清单和 tgz 的重新验证。
 * 契约见 edu-agent 的 docs/decisions/0043-edu-plugin-hot-update.md「实现接口约定」。
 * 更新器插件（packages/dsh-edu/updater）下载时做同样的验证；这里是预装侧（启动时）的第二道检查，
 * 所以只依赖 node 内置模块，不依赖更新器。
 */

import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { valid } from 'semver'

/** 清单里 tgz 大小上限（字节），与契约一致。 */
export const HOT_UPDATE_MAX_SIZE = 200 * 1024 * 1024
const TARBALL = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u
const SHA256 = /^[0-9a-f]{64}$/u

/** `yunsun.json.hotUpdate`：更新源和验签公钥。 */
export interface YunsunHotUpdateConfig {
  /** http(s) 地址，以 / 结尾。 */
  readonly feedUrl: string
  /** keyId 到 Ed25519 公钥（SPKI PEM）。 */
  readonly publicKeys: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertEd25519(pem: string, field: string): void {
  let type: string | undefined
  try { type = createPublicKey(pem).asymmetricKeyType } catch (error) {
    throw new Error(`yunsun.json: ${field} 不是可解析的公钥：${(error as Error).message}`)
  }
  if (type !== 'ed25519') throw new Error(`yunsun.json: ${field} 必须是 ed25519 公钥，收到 ${String(type)}`)
}

/**
 * 校验 `hotUpdate` 字段；任何一项不合法都抛出带字段名的错误。
 * @param value - yunsun.json 里的 hotUpdate 值（已确认存在）。
 */
export function parseHotUpdateConfig(value: unknown): YunsunHotUpdateConfig {
  if (!isRecord(value)) throw new Error('yunsun.json: hotUpdate 必须是对象')
  const feed = value.feedUrl
  if (typeof feed !== 'string') throw new Error('yunsun.json: hotUpdate.feedUrl 必须是字符串')
  let protocol: string
  try { protocol = new URL(feed).protocol } catch { throw new Error('yunsun.json: hotUpdate.feedUrl 不是合法 URL') }
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`yunsun.json: hotUpdate.feedUrl 必须是 http/https，收到 ${protocol}`)
  if (!feed.endsWith('/')) throw new Error('yunsun.json: hotUpdate.feedUrl 必须以 / 结尾')
  const keys = value.publicKeys
  if (!isRecord(keys) || Object.keys(keys).length === 0) throw new Error('yunsun.json: hotUpdate.publicKeys 至少要有一项')
  const publicKeys: Record<string, string> = {}
  for (const [keyId, pem] of Object.entries(keys)) {
    if (typeof pem !== 'string') throw new Error(`yunsun.json: hotUpdate.publicKeys.${keyId} 必须是 PEM 字符串`)
    assertEd25519(pem, `hotUpdate.publicKeys.${keyId}`)
    publicKeys[keyId] = pem
  }
  return { feedUrl: feed, publicKeys }
}

/** 清单字段（全部必填）。 */
export interface HotUpdateManifest {
  readonly schemaVersion: 1
  readonly name: string
  readonly version: string
  readonly dshVersion: string
  readonly file: string
  readonly sha256: string
  readonly size: number
  readonly keyId: string
  readonly expiresAt: string
}

/** 契约的 9 个字段，键名字典序。 */
const MANIFEST_KEYS = ['dshVersion', 'expiresAt', 'file', 'keyId', 'name', 'schemaVersion', 'sha256', 'size', 'version'] as const

/**
 * 规范化字节：契约里的 9 个字段按键名字典序排序后 JSON.stringify（无空格），UTF-8。
 * @param manifest - 已校验的清单。
 */
export function canonicalManifestBytes(manifest: HotUpdateManifest): Buffer {
  const ordered: Record<string, unknown> = {}
  for (const key of MANIFEST_KEYS) ordered[key] = manifest[key]
  return Buffer.from(JSON.stringify(ordered), 'utf8')
}

const BUILD_VERSION = /^0\.0\.0-build\.\d{14}$/u
const EXPIRES_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

/**
 * 校验清单：必须恰好是契约的 9 个字段（缺字段或有未知字段都算坏），file 必须等于 `yunsun-dsh-edu-<version>.tgz`，
 * version 匹配 `0.0.0-build.<14 位数字>`，expiresAt 是 toISOString() 格式。
 */
export function parseManifest(value: unknown): HotUpdateManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('manifest: schemaVersion 必须是 1')
  const keys = Object.keys(value).sort()
  if (keys.length !== MANIFEST_KEYS.length || keys.some((key, index) => key !== MANIFEST_KEYS[index])) {
    throw new Error(`manifest: 字段必须恰好是 ${MANIFEST_KEYS.join(', ')}，收到 ${keys.join(', ')}`)
  }
  const text = (key: string): string => {
    const field = value[key]
    if (typeof field !== 'string' || field === '') throw new Error(`manifest: ${key} 必须是非空字符串`)
    return field
  }
  const manifest: HotUpdateManifest = {
    schemaVersion: 1, name: text('name'), version: text('version'), dshVersion: text('dshVersion'), file: text('file'),
    sha256: text('sha256'), size: value.size as number, keyId: text('keyId'), expiresAt: text('expiresAt'),
  }
  if (valid(manifest.version) === null || !BUILD_VERSION.test(manifest.version)) throw new Error('manifest: version 必须匹配 0.0.0-build.<14 位数字>')
  if (!TARBALL.test(manifest.file) || manifest.file !== `yunsun-dsh-edu-${manifest.version}.tgz`) throw new Error('manifest: file 必须等于 yunsun-dsh-edu-<version>.tgz')
  if (!EXPIRES_AT.test(manifest.expiresAt)) throw new Error('manifest: expiresAt 必须是 toISOString() 格式')
  if (!SHA256.test(manifest.sha256)) throw new Error('manifest: sha256 必须是小写 hex')
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > HOT_UPDATE_MAX_SIZE) throw new Error('manifest: size 超出范围')
  return manifest
}

/** 验证通过的 staged 包。 */
export interface VerifiedStagedPackage {
  readonly manifest: HotUpdateManifest
  readonly tarballPath: string
}

function sha256Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (chunk) => { hash.update(chunk) }).on('error', reject).on('end', () => { resolve(hash.digest('hex')) })
  })
}

/**
 * 重新验证一个带 `.ok` 的 staged 目录：签名、name、dshVersion、version 与目录名一致、tgz 的 size 和 sha256。
 * 有意不检查 expiresAt：老师可能下载后很久才重启，启动时清单过期不应让已下载并验过的包作废
 * （接受清单时由更新器检查过期）；签名、sha256、size、dshVersion 和黑名单照查。
 * @param dir - `<profile>/yunsun-updates/staged/<version>`。
 * @param version - 目录名（期望的版本）。
 * @returns 通过的包；失败时抛出带原因的错误，由调用方决定删除。
 */
export async function verifyStagedPackage(options: {
  readonly dir: string
  readonly version: string
  readonly bundleName: string
  readonly dshVersion: string
  readonly publicKeys: Readonly<Record<string, string>>
}): Promise<VerifiedStagedPackage> {
  const { dir } = options
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
  const publicKey = options.publicKeys[manifest.keyId]
  if (publicKey === undefined) throw new Error(`manifest: 未知 keyId ${manifest.keyId}`)
  const signature = Buffer.from(readFileSync(join(dir, 'manifest.sig'), 'utf8').trim(), 'base64')
  if (!verify(null, canonicalManifestBytes(manifest), createPublicKey(publicKey), signature)) throw new Error('manifest: 签名验证失败')
  if (manifest.name !== options.bundleName) throw new Error(`manifest: name 应为 ${options.bundleName}`)
  if (manifest.dshVersion !== options.dshVersion) throw new Error(`manifest: dshVersion ${manifest.dshVersion} 与当前 ${options.dshVersion} 不一致`)
  if (manifest.version !== options.version) throw new Error(`manifest: version ${manifest.version} 与目录名 ${options.version} 不一致`)
  const tarballPath = join(dir, manifest.file)
  if (!existsSync(tarballPath)) throw new Error(`staged: 缺少 ${manifest.file}`)
  if (statSync(tarballPath).size !== manifest.size) throw new Error('staged: tgz 大小与清单不一致')
  if (await sha256Of(tarballPath) !== manifest.sha256) throw new Error('staged: tgz sha256 与清单不一致')
  return { manifest, tarballPath }
}
