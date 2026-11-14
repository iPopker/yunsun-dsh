/**
 * [yunsun] P1 品牌：云隼智教 fork 的产品名。
 * 上游文案里的 "DeepSeek Harness" 在 locale 出口统一替换，上游新增文案也会自动跟着换，
 * 补丁只占 locale.ts、main.ts 各一处。见 edu-agent 的 docs/decisions/0030-dsh-thin-fork.md。
 *
 * 只有设置了 DSH_PRODUCT_BRAND=yunsun 才替换：上游测试断言的是原版文案，不设时保持原样，
 * 跟版本时不用改上游测试。`pnpm dev:dsh` 会设置它；打包版由 yunsun-packaged-init.ts 在发现 resources/yunsun/yunsun.json 时设置（P4，ADR 0035）。
 */

/** 所有语言统一使用的产品名。 */
export const YUNSUN_PRODUCT_NAME = '云隼智教'

const UPSTREAM_PRODUCT_NAME = 'DeepSeek Harness'

/** 环境变量表；locale.ts 也被渲染进程使用，那里没有 Node 类型，也可能没有 process。 */
type Env = Readonly<Record<string, string | undefined>>

function currentEnv(): Env {
  const runtime = globalThis as { process?: { env?: Env } }
  return runtime.process?.env ?? {}
}

/** 当前进程是否启用云隼智教品牌。 */
export function yunsunBrandEnabled(env: Env = currentEnv()): boolean {
  return env.DSH_PRODUCT_BRAND === 'yunsun'
}

/** 启用品牌时返回云隼智教，否则返回上游产品名。 */
export function productName(env: Env = currentEnv()): string {
  return yunsunBrandEnabled(env) ? YUNSUN_PRODUCT_NAME : UPSTREAM_PRODUCT_NAME
}

/**
 * 把一份桌面端文案字典里的上游产品名原地替换成云隼智教。
 * @param messages - 某种语言的桌面端文案字典。
 */
export function applyYunsunBrand(messages: Record<string, string>): void {
  for (const key of Object.keys(messages)) {
    const text = messages[key]
    if (text !== undefined && text.includes(UPSTREAM_PRODUCT_NAME)) {
      messages[key] = text
        .replaceAll(UPSTREAM_PRODUCT_NAME, YUNSUN_PRODUCT_NAME)
        // 中文产品名和汉字之间不留空格，例如「退出 DeepSeek Harness」换成「退出云隼智教」。
        .replaceAll(/(\p{Script=Han}) (?=云隼智教)/gu, '$1')
        .replaceAll(/(云隼智教) (?=\p{Script=Han})/gu, '$1')
    }
  }
}
