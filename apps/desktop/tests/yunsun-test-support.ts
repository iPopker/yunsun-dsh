// [yunsun] P4 热更新预装测试的共用工具（不是 spec，不会被 vitest 当测试收集）。
import { generateKeyPairSync, createHash, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DSH_VERSION = '0.2.2-rc.3'

/** 模拟内置 pnpm：把 `./yunsun-packages/<file>` 当成已安装，写出 node_modules 里的 package.json。 */
export function fakePnpm(calls: { args: readonly string[]; cwd: string }[] = []): (args: readonly string[], cwd: string) => Promise<void> {
  return (args, cwd) => {
    calls.push({ args, cwd })
    const match = /yunsun-(dsh-edu(?:-updater)?)-(.+)\.tgz$/u.exec(args[1] ?? '')
    if (match === null) return Promise.reject(new Error(`fakePnpm: 看不懂 ${String(args[1])}`))
    installedPackage(cwd, `@yunsun/${match[1]}`, match[2] as string)
    return Promise.resolve()
  }
}

/** 直接写一个「已装」包。 */
export function installedPackage(profileDir: string, name: string, version: string, engines: string | undefined = DSH_VERSION): void {
  const dir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, ...engines === undefined ? {} : { engines: { dsh: engines } } }))
}

export interface TestKey { readonly keyId: string; readonly publicPem: string; readonly privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] }

export function makeKey(keyId = 'k1'): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { keyId, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey }
}

/** 契约里的规范化字节：字段按键名字典序，无空格 JSON，UTF-8。 */
export function canonical(manifest: Record<string, unknown>): Buffer {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(manifest).sort()) ordered[key] = manifest[key]
  return Buffer.from(JSON.stringify(ordered), 'utf8')
}

/** 在 `<profile>/yunsun-updates/staged/<version>/` 写一个完整的 staged 目录。 */
export function writeStaged(profileDir: string, key: TestKey, version: string, options: {
  readonly dshVersion?: string
  readonly content?: string
  readonly tamperSha?: boolean
  readonly tamperSize?: boolean
  readonly signWith?: TestKey
  readonly ok?: boolean
} = {}): string {
  const dir = join(profileDir, 'yunsun-updates', 'staged', version)
  mkdirSync(dir, { recursive: true })
  const content = options.content ?? `tgz-${version}`
  const file = `yunsun-dsh-edu-${version}.tgz`
  writeFileSync(join(dir, file), content)
  const manifest = {
    schemaVersion: 1, name: '@yunsun/dsh-edu', version, dshVersion: options.dshVersion ?? DSH_VERSION, file,
    sha256: options.tamperSha === true ? '0'.repeat(64) : createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content) + (options.tamperSize === true ? 1 : 0),
    keyId: key.keyId, expiresAt: '2099-01-01T00:00:00.000Z',
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, undefined, 2))
  writeFileSync(join(dir, 'manifest.sig'), `${sign(null, canonical(manifest), (options.signWith ?? key).privateKey).toString('base64')}\n`)
  if (options.ok !== false) writeFileSync(join(dir, '.ok'), '')
  return dir
}
