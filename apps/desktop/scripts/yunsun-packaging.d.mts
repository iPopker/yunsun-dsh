/** One installer language as read by installer-locales.mjs; only the fields branding touches are named. */
export interface BrandableInstallerLocale {
  strings: Record<string, string>
  uninstaller: Record<string, string>
}

/** [yunsun] Absolute paths of the branded icon files. */
export interface YunsunPackagingIcons {
  macos: string
  windows: string
  tray: string
}

/** [yunsun] Branded packaging identity; absent for upstream builds. */
export interface YunsunPackaging {
  productName: string
  appId: string
  artifactPrefix: string
  icons: YunsunPackagingIcons
}

/**
 * Resolve the Yunsun branded packaging settings.
 * @param env - Packaging environment.
 * @returns Branded settings, or undefined when YUNSUN_DESKTOP_PRODUCT_NAME is unset or blank (upstream build).
 */
export function resolveYunsunPackaging(env: NodeJS.ProcessEnv): YunsunPackaging | undefined

/**
 * Product name used for packaged application and executable names.
 * @param env - Packaging environment.
 * @returns The branded product name, or the upstream 'DeepSeek Harness'.
 */
export function desktopProductName(env: NodeJS.ProcessEnv): string

/**
 * Replace the upstream product name in installer resources.
 * @param locales - Installer locales; not modified.
 * @param productName - Branded product name.
 * @returns New locale objects with the product name substituted in strings and uninstaller.
 */
export function brandInstallerLocales<T extends BrandableInstallerLocale>(locales: readonly T[], productName: string): T[]
