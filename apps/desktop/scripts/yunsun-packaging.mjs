/** [yunsun] 品牌打包配置：只在设置 YUNSUN_DESKTOP_PRODUCT_NAME 时生效，不设则与上游构建完全一致。 */
import { fileURLToPath } from 'node:url'

const UPSTREAM_PRODUCT_NAME = 'DeepSeek Harness'
const DEFAULT_APP_ID = 'com.yunsun.edu'
const APP_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u
// 应用版本必须是 semver：electron-builder 和 Electron 的 app.getVersion() 都按 semver 处理。
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

/**
 * Resolve the Yunsun branded packaging settings.
 * YUNSUN_DESKTOP_VERSION overrides the packaged application version (for example 3.0.0) while the
 * bundled runtime keeps verifying against the upstream product version in package.json.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {{ productName: string, appId: string, version: string | undefined, artifactPrefix: string, icons: { macos: string, windows: string, tray: string } } | undefined}
 *   Branded settings, or undefined when YUNSUN_DESKTOP_PRODUCT_NAME is unset or blank (upstream build).
 */
export function resolveYunsunPackaging(env) {
  const productName = env.YUNSUN_DESKTOP_PRODUCT_NAME?.trim()
  if (productName === undefined || productName === '') return undefined
  const appId = env.YUNSUN_DESKTOP_APP_ID?.trim() || DEFAULT_APP_ID
  if (!APP_ID_PATTERN.test(appId)) throw new Error('yunsun packaging: YUNSUN_DESKTOP_APP_ID must be a reverse-DNS identifier')
  const version = env.YUNSUN_DESKTOP_VERSION?.trim() || undefined
  if (version !== undefined && !VERSION_PATTERN.test(version)) {
    throw new Error(`yunsun packaging: YUNSUN_DESKTOP_VERSION must be a semver version such as 3.0.0, got ${JSON.stringify(version)}`)
  }
  if (version !== undefined && env.DSH_DESKTOP_BUILD_VERSION?.trim()) {
    throw new Error('yunsun packaging: set YUNSUN_DESKTOP_VERSION or DSH_DESKTOP_BUILD_VERSION, not both')
  }
  return {
    productName,
    appId,
    version,
    artifactPrefix: 'yunsun-edu',
    icons: {
      macos: fileURLToPath(new URL('../resources/yunsun/icon-macos.png', import.meta.url)),
      windows: fileURLToPath(new URL('../resources/yunsun/icon-windows.png', import.meta.url)),
      tray: fileURLToPath(new URL('../resources/yunsun/tray-windows.ico', import.meta.url)),
    },
  }
}

/**
 * Product name used for packaged application and executable names.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string} The branded product name, or the upstream 'DeepSeek Harness'.
 */
export function desktopProductName(env) {
  return resolveYunsunPackaging(env)?.productName ?? UPSTREAM_PRODUCT_NAME
}

/**
 * Artifact file name stem, matching electron-builder's artifactName before the os, arch and suffix.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {string} buildVersion - Version the upstream build would publish.
 * @returns {string} `yunsun-edu-<version>` for branded builds, otherwise `deepseek-harness-<buildVersion>`.
 */
export function desktopArtifactStem(env, buildVersion) {
  const yunsun = resolveYunsunPackaging(env)
  if (yunsun === undefined) return `deepseek-harness-${buildVersion}`
  return `${yunsun.artifactPrefix}-${yunsun.version ?? buildVersion}`
}

function escapeRegExp(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function brandRecord(record, productName) {
  const name = escapeRegExp(productName)
  const beforeName = new RegExp(`(\\p{Script=Han}) (?=${name})`, 'gu')
  const afterName = new RegExp(`(${name}) (?=\\p{Script=Han})`, 'gu')
  return Object.fromEntries(Object.entries(record).map(([key, text]) => [key, text
    .replaceAll(UPSTREAM_PRODUCT_NAME, () => productName)
    // 中文产品名和汉字之间不留空格（与 src/yunsun-brand.ts 的 applyYunsunBrand 一致）。
    .replaceAll(beforeName, '$1')
    .replaceAll(afterName, '$1')]))
}

/**
 * Replace the upstream product name in installer resources.
 * @param {ReadonlyArray<{ strings: Record<string, string>, uninstaller: Record<string, string> }>} locales - Installer locales; not modified.
 * @param {string} productName - Branded product name.
 * @returns {Array<object>} New locale objects with the product name substituted in strings and uninstaller.
 */
export function brandInstallerLocales(locales, productName) {
  return locales.map(locale => ({
    ...locale,
    strings: brandRecord(locale.strings, productName),
    uninstaller: brandRecord(locale.uninstaller, productName),
  }))
}
