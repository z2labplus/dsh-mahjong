# 独立原牌桌

在本目录运行 `npm ci`、`npm run check`、`npm run build`，然后从同仓库 `service/` 运行开发服务。静态包随 Worker 发布，牌桌位于 `/hand/`，由 Harness 生成真人或旁观邀请链接。源码和素材都在本仓库，构建不访问原 MJAI。

本次仅适配入口与连接，保留原渲染、比例、操作、声音。来源文件与哈希见 `../docs/hand-parity-manifest.json`，验收见 `../docs/hand-migration.md`。

代码许可见 `licenses/mjai-COPYING`，素材归属和原作者链接见 `licenses/upstream-assets.md`。资源不统一采用 MIT；额外素材依据用户在 2026-09-07 确认的已有授权迁移。仓库整体未另行选择许可证。
