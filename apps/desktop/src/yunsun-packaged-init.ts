/**
 * [yunsun] P4 副作用模块：必须是 main.ts 的第一个 import。
 * 品牌开关在 locale.ts 加载时就读环境变量，所以要在其他模块求值之前，把打包期标记换成环境变量。
 * 上游构建、开发版没有标记，这里什么都不做。读到不合法的标记会直接抛出，应用不会带着半截配置启动。
 */
import { applyYunsunPackagedEnv, readYunsunPackagedResources } from './yunsun-preinstall.ts'

const resources = readYunsunPackagedResources((process as { resourcesPath?: string }).resourcesPath)
if (resources !== undefined) applyYunsunPackagedEnv(process.env, resources)
