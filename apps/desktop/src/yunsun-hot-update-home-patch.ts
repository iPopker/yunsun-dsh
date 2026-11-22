/**
 * [yunsun] P4 home 层补丁（ADR 0043 第 4 条）：`$DSH_HOME/cordis.patch.yml` 优先级高于 profile 层，
 * 热更新替换教育 bundle 的空窗里，bundle 关掉的 DeepSeek 上报和品牌行不会被重新启用；界面也改不了它。
 * 文件格式是 patch 行列表（`- id: <行 id>` + `disabled: true`），分层见 dsh/apps/cli/src/profile-boot.ts 的 homePatchPath。
 *
 * 文件头第一行是固定标记：有标记 = 我们写的，整体覆盖；没有标记 = 用户自己的文件，保留内容，只补缺的行。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/** home 层补丁文件名。 */
export const YUNSUN_HOME_PATCH_FILE = 'cordis.patch.yml'
/** 文件头标记（第一行，整行相等才算我们写的）。 */
export const YUNSUN_HOME_PATCH_MARKER = '# yunsun-managed: 云隼智教自动生成，每次启动会重写；要自定义请删除本行，改动会被保留'
/** 要禁用的行 id：DeepSeek 上报和上游品牌、账号界面。 */
export const YUNSUN_HOME_PATCH_DISABLED_IDS: readonly string[] = [
  'session-log-deepseek',
  'plugin-package-inventory-deepseek',
  'session-telemetry-otel',
  'ui-brand-official',
  'ui-account-notifications',
  'ui-settings-account',
]

function entryText(id: string): string {
  return `- id: ${id}\n  disabled: true\n`
}

function managedContent(): string {
  return `${YUNSUN_HOME_PATCH_MARKER}\n${YUNSUN_HOME_PATCH_DISABLED_IDS.map(entryText).join('')}`
}

/**
 * 幂等写 home 层补丁。
 * - 文件不存在：新建（带标记）。
 * - 第一行是标记：内容不同则覆盖。
 * - 否则按用户文件合并：这几个 id 都已 `disabled: true` 就不动；缺的 id 追加到末尾（保留原有注释和内容）；
 *   已有同 id 行但没禁用、文件无法解析或根不是列表时抛错，不猜着改用户的配置。
 * @param dshHome - DSH_HOME 目录。
 * @returns 'created' | 'updated' | 'merged' | 'unchanged'。
 */
export function ensureYunsunHomePatch(dshHome: string): 'created' | 'updated' | 'merged' | 'unchanged' {
  const path = join(dshHome, YUNSUN_HOME_PATCH_FILE)
  if (!existsSync(path)) {
    writeFileSync(path, managedContent())
    return 'created'
  }
  const current = readFileSync(path, 'utf8')
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  if (current.replaceAll('\r\n', '\n').split('\n', 1)[0] === YUNSUN_HOME_PATCH_MARKER) {
    if (current.replaceAll('\r\n', '\n') === managedContent()) return 'unchanged'
    writeFileSync(path, managedContent())
    return 'updated'
  }
  let parsed: unknown
  try { parsed = load(current) } catch (error) {
    throw new Error(`yunsun home patch: ${path} 不是用户可安全合并的 YAML（${(error as Error).message}）。请手动加入以下行，或删除该文件让云隼重新生成：\n${managedContent()}`)
  }
  if (parsed !== undefined && parsed !== null && !Array.isArray(parsed)) {
    throw new Error(`yunsun home patch: ${path} 根节点不是列表，无法合并。请手动加入禁用行：${YUNSUN_HOME_PATCH_DISABLED_IDS.join(', ')}`)
  }
  const entries = (parsed ?? []) as unknown[]
  const missing: string[] = []
  for (const id of YUNSUN_HOME_PATCH_DISABLED_IDS) {
    const existing = entries.filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === id)
    if (existing.length === 0) missing.push(id)
    else if (existing.some(entry => entry.disabled !== true)) {
      throw new Error(`yunsun home patch: ${path} 里的 ${id} 没有设为 disabled: true，云隼不会改写你的配置；请改成 disabled: true`)
    }
  }
  if (missing.length === 0) return 'unchanged'
  const separator = current === '' || current.endsWith('\n') ? '' : eol
  const addition = `${separator}# yunsun: 云隼智教需要关闭的行\n${missing.map(entryText).join('')}`.replaceAll('\n', eol)
  const merged = current + addition
  let reparsed: unknown
  try { reparsed = load(merged) } catch { reparsed = undefined }
  const mergedIds = Array.isArray(reparsed) ? reparsed.map(entry => (entry as { id?: unknown } | null)?.id) : []
  if (missing.some(id => !mergedIds.includes(id))) {
    throw new Error(`yunsun home patch: ${path} 的写法（例如行内列表）无法在末尾安全追加。请手动加入禁用行：${missing.join(', ')}`)
  }
  writeFileSync(path, merged)
  return 'merged'
}
