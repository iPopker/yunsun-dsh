/**
 * [yunsun] P1 品牌：把界面文案里的上游产品名换成云隼智教。
 *
 * 只在桌面端 preload 暴露了 `__DSH_PRODUCT_BRAND__ = 'yunsun'` 时生效：
 * 开发版由 `pnpm dev:dsh` 设 `DSH_PRODUCT_BRAND=yunsun`，打包版由 yunsun-packaged-init 按 yunsun.json 设置。
 * 浏览器端读不到 process.env，客户端产物又是预构建的，所以只能用运行时标记。
 * 上游测试不设标记，断言的原版文案不受影响，跟版本时不用改上游测试。
 */

/** 所有语言统一使用的产品名。 */
export const YUNSUN_PRODUCT_NAME = '云隼智教'

const UPSTREAM_PRODUCT_NAME = 'DeepSeek Harness'

/**
 * 当前渲染进程是否跑在云隼品牌模式下。
 * @returns whether the renderer runs the Yunsun-branded desktop.
 */
export function yunsunBrandActive(): boolean {
  return (globalThis as { __DSH_PRODUCT_BRAND__?: unknown }).__DSH_PRODUCT_BRAND__ === 'yunsun'
}

/** 上游内部代号：侧栏版本位会显示「DSH 本地构建」，界面上不能露出来。 */
const INTERNAL_CODENAME = 'DSH'

/**
 * 品牌模式下把文案里的上游产品名换成云隼智教；其他情况原样返回。
 * @param text - 已插值的界面文案。
 * @returns 品牌化后的文案。
 */
export function yunsunBrandText(text: string): string {
  if (!yunsunBrandActive()) return text
  const touched = text.includes(UPSTREAM_PRODUCT_NAME) || text.includes(INTERNAL_CODENAME)
  if (!touched) return text
  return text
    .split(UPSTREAM_PRODUCT_NAME).join(YUNSUN_PRODUCT_NAME)
    // 侧栏版本位的「DSH 本地构建」：内部代号直接换成产品名。
    .replaceAll(/\bDSH\b/gu, YUNSUN_PRODUCT_NAME)
    // 中文产品名和汉字之间不留空格，例如「返回 DeepSeek Harness」换成「返回云隼智教」。
    // 放在替换之后：代号换成产品名同样要贴合前后汉字。
    .replaceAll(/(\p{Script=Han}) (?=云隼智教)/gu, '$1')
    .replaceAll(/(云隼智教) (?=\p{Script=Han})/gu, '$1')
}
