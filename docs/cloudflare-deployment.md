# Cloudflare 部署与维护

本地运行官方 Harness，Cloudflare 运行 dsh-mahjong 的静态牌桌、规则、房间、牌谱与用户数据库。统一托管和自行部署使用同一个部署包。广东、支付和视频发布不在当前产品范围。

## 首次部署

先在根目录完成 `npm run setup` 和全部检查。下面的命令在 `service/` 执行：

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put SERVICE_SECRET
```

`wrangler.jsonc` 的 `name` 是云端项目名；使用自己的账号，可按需改名。不要覆盖不属于本项目的现有 Worker。最后一条命令交互输入管理员生成并妥善保存的随机签名密钥（至少 32 字符）。不要复用示例占位值。所有账号和座位凭证都基于它，后续更新必须保留同一密钥。

部署完成后确认服务 `/health` 可访问且 `frontendReady=true`。两个 Durable Object 类使用 SQLite 迁移，无需 D1、KV、R2 或 Containers；`TABLES` 保存每桌状态与记录，`DIRECTORY` 保存用户、配额、牌谱索引和教学进度。

## 配置管理员的本地 Harness

在管理员私有环境中通过 `service/scripts/issue-token.ts <tenant> <owner> --admin` 签发管理员凭证；`SERVICE_SECRET` 由环境变量提供。凭证有效 30 天，签名密钥不进入 Harness，也不进入前端。

将以下结构保存在根目录 `.local/connection.json`，文件权限设为仅本人可读写：

```json
{
  "url": "https://你的项目.workers.dev",
  "owner": "administrator",
  "ownerApiToken": "管理员凭证"
}
```

运行根目录 `npm start`。远端连接模式只启动本地 Harness。若原本正在运行本地模式，先用 `npm stop` 正常停止。不同服务/账号会使用不同的本地 Harness 数据目录；服务更换不会自动迁移旧数据库。

管理员在「我的牌谱 → 服务使用者管理」生成其他使用者的一次性邀请，可同时设置配额。使用者运行安装助手的 `connect <服务网址>` 领取，之后模型密钥和 AI 会话仍在其自己的电脑上。

## 权限与数据

默认每人保留 50 份记录、最多同时 4 桌；管理员可以调整。邀请有效 1 天、只能领取一次；牌局座位凭证有效 1 天；使用者凭证有效 30 天。撤销使用者会作废其旧凭证；撤销某真人座位只影响该座位。

公开分享有效 7 天，每份牌谱最多 20 个有效链接；分享者可随时撤销。导出和分享使用桌主当时的选手视角（全 AI 对局默认东家），不会公开未摸牌墙。导入文件经结构检查后只允许只读回放，不携带服务器内部秘密存档，也不能创建练习分支。

升级使用同一 Worker 名称与原迁移记录。不要删除或重建 Durable Object 命名空间来做普通升级。保留私有签名密钥和管理员凭证；轮换密钥会同时作废所有当前凭证。源码、密钥和数据库的备份应分别管理。

## 免费额度

Cloudflare Workers Free 支持 SQLite Durable Objects。免费额度包括每日请求、计算时长、读写行数与总存储限制，超限会影响服务可用性；统一托管时尤其需要结合用户配额和实际流量控制规模。部署脚本不会购买付费计划。具体额度以 [Durable Objects 官方计费页](https://developers.cloudflare.com/durable-objects/platform/pricing/) 和 [限制页](https://developers.cloudflare.com/durable-objects/platform/limits/) 为准（核查于 2026-09-07）。

原始模型 API 费用由使用者自己的模型供应商计算，与 Cloudflare 服务额度分开。
