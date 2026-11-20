/**
 * [yunsun] P4 副作用模块：必须是 main.ts 的第一个 import。
 * 品牌开关在 locale.ts 加载时就读环境变量，所以要在其他模块求值之前，把打包期标记换成环境变量。
 * 上游构建、开发版没有标记，这里什么都不做。读到不合法的标记会直接抛出，应用不会带着半截配置启动。
 *
 * 打包版还要换掉 Electron 的 userData 目录：默认目录取自包名 `@deepseek-ai/dsh-desktop`，和上游
 * DeepSeek Harness 相同，单实例锁会让两个应用不能同时运行。main.ts 在模块求值时就读 userData，
 * 所以也必须在这里设置。命令行传了 `--user-data-dir` 时以它为准。
 */
import { join } from 'node:path'
import { app } from 'electron'
import { applyYunsunPackagedEnv, readYunsunPackagedResources, YUNSUN_USER_DATA_DIR_NAME } from './yunsun-preinstall.ts'

const resources = readYunsunPackagedResources((process as { resourcesPath?: string }).resourcesPath)
if (resources !== undefined) {
  applyYunsunPackagedEnv(process.env, resources)
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', join(app.getPath('appData'), YUNSUN_USER_DATA_DIR_NAME))
  }
}
