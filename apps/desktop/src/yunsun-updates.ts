/**
 * [yunsun] P2 关闭整包更新（见 edu-agent 的 docs/decisions/0030-dsh-thin-fork.md）。
 * 云隼智教的更新走自己的发布服务，不使用上游的整包更新和强制更新策略，因此云隼构建永不连接
 * download.deepseek.com、COS 或任何 mandatory-update 策略地址。只在入口切断：electron-updater 依赖、
 * 上游更新模块和测试都原样保留，上游构建（没有 yunsun.json）行为不变。
 *
 * 判定依据是打包进应用的 `<resources>/yunsun/yunsun.json`，不看 DSH_PRODUCT_BRAND：
 * 后者由 yunsun-packaged-init 用 `??=` 设置，会被外部环境变量覆盖。
 */

import { readYunsunPackagedResources } from './yunsun-preinstall.ts'

/**
 * 当前进程是否是云隼构建（整包更新必须关闭）。yunsun.json 存在但不合法时抛出，与 yunsun-packaged-init 一致。
 * @param resourcesPath - Electron 的 process.resourcesPath；开发版传 undefined 或没有该目录。
 */
export function yunsunUpdatesDisabled(resourcesPath: string | undefined): boolean {
  return readYunsunPackagedResources(resourcesPath) !== undefined
}

/**
 * 强制更新策略的输入：云隼构建恒为 undefined，resolveDesktopPolicyConfig 随之不创建策略，不发任何请求。
 * @param disabled - yunsunUpdatesDisabled 的结果。
 * @param input - 上游从应用清单或开发环境变量得到的策略输入。
 */
export function yunsunMandatoryPolicyInput(disabled: boolean, input: unknown): unknown {
  return disabled ? undefined : input
}

/**
 * DesktopUpdateCoordinator 的 `enabled` 参数：云隼构建恒为 false，协调器在 checkForUpdates 之前就报错返回。
 * @param disabled - yunsun 判定结果。
 * @returns 云隼构建返回 `() => false`；否则 undefined，让协调器使用上游默认判定。
 */
export function yunsunCoordinatorEnabled(disabled: boolean): (() => boolean) | undefined {
  return disabled ? () => false : undefined
}
