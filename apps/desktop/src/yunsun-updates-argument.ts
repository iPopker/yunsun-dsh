/**
 * [yunsun] P2 关闭整包更新：主进程和 preload 之间的开关参数。
 * preload 是沙箱脚本，不能读文件，也不能 import node:fs，所以这里只放不依赖 Node 的纯函数；
 * 读 yunsun.json 的判断在 yunsun-updates.ts（只给主进程用）。
 */

/** 主进程判定为云隼构建后，加在每个窗口 webPreferences.additionalArguments 里的参数。 */
export const YUNSUN_UPDATES_DISABLED_ARGUMENT = '--yunsun-updates-disabled'

/**
 * @param disabled - 主进程判定的「云隼构建，整包更新已关闭」。
 * @returns 传给 additionalArguments 的参数；上游构建为空数组，窗口参数与上游一致。
 */
export function yunsunUpdatesDisabledArguments(disabled: boolean): string[] {
  return disabled ? [YUNSUN_UPDATES_DISABLED_ARGUMENT] : []
}

/**
 * preload 判断是否应该向页面暴露 `dshDesktop.updates`。
 * @param argv - preload 里的 process.argv。
 * @returns 没有关闭参数时为 true（与上游一致）。
 */
export function yunsunUpdatesBridgeExposed(argv: readonly string[]): boolean {
  return !argv.includes(YUNSUN_UPDATES_DISABLED_ARGUMENT)
}
