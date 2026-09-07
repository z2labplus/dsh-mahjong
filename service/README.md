# dsh-mahjong Cloudflare 服务

支持血战与标准国标，提供原牌桌静态资源、权威动作校验、超时、恢复、历史记录、分享、历史局面练习、教练和用户管理。安装说明见 [主 README](../README.md)，部署及凭证维护见 [部署文档](../docs/cloudflare-deployment.md)。

每桌一个 SQLite Durable Object；另一个 Directory 对象按 tenant 隔离用户、配额、牌谱索引和教学进度。快照、去重记录、历史帧与下一次闹钟事务保存；目录更新采用可重试记录，教学结果按牌局去重。WebSocket 使用休眠 API，空闲时不轮询。

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 运行状态、规则与静态资源绑定 |
| `PUT/GET /v1/tables/<UUID>` | 创建/恢复自己的牌桌 |
| `GET .../ws` | 座位和观战 WebSocket |
| `POST/GET .../session?seat=N` | 一次性邀请换取 HttpOnly Cookie / 恢复 |
| `GET /v1/library` | 自己的牌谱目录 |
| `GET .../history`、`.../history/N` | 步骤索引与权限过滤帧 |
| `GET/PUT .../replay` | 导出完整记录 / 导入只读记录 |
| `GET/POST .../shares`、`DELETE .../shares/<UUID>` | 列出、创建、撤销分享 |
| `GET /v1/shares/<game>/<share>` | 有效分享的只读记录 |
| `POST .../practice` | 从服务器历史存档新建独立练习 |
| `GET /v1/coach/lessons` | 课程与当前用户进度 |
| `PUT/GET .../coach` | 创建关卡 / 查询反馈 |
| `GET/POST /v1/admin/users` | 管理员用户、邀请、撤销和配额 |
| `POST /v1/invitations/redeem` | 一次性使用者邀请兑换 |
| `POST .../seats/N/revoke` | 撤销座位旧邀请与连接 |

除公开健康状态、静态资源、有效分享和邀请兑换外，接口使用服务器签发的凭证。管理功能要求管理员身份；房间归属、座位、规则及操作范围均由服务校验。真人和 AI 返回的动作必须匹配当次合法动作，过期动作拒绝，最近 128 个动作可幂等重试。

牌局内部秘密存档不经 HTTP 接口导入或导出。历史练习通过对象间内部调用建立，调用者不能提交任意引擎状态。全 AI 桌主可以观看四家当前手牌；有真人时只看自己的暗牌，未来牌墙始终隐藏。分享/导出进一步固定为一个选手当时的可见范围。

`npm run check` 检查类型和来源哈希，`npm test` 构建后运行真实 workerd/SQLite 集成验证，`npm run build` 仅生成部署预览。提取代码遵循保留的上游许可；第三方素材见前端的独立来源清单。
