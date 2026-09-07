# dsh-mahjong · 麻将实验室

在本地官方 DeepSeek Harness 中打麻将、复盘和练习。牌桌与游戏服务由本项目提供，可在本机运行，也可部署到 Cloudflare。管理员统一托管和使用者自行部署使用同一套功能。

不需要 MJAI 仓库、进程、账号或数据库。Harness 核心未修改；模型配置、API 密钥、独立 AI 会话和原生问答均留在本地。

侧栏入口和开桌面板统一使用 MJLab.ai 的金色 ML Logo，复用随包提供的原始图标，显示时无需请求 mjlab.ai。

旧 MJAI 后端兼容入口已移除：插件只接受 `service` 配置，不再接受 `mjai`、静态 `seats` 或旧座位 API Token；不再默认连接旧服务端口。AI 通过独立牌局服务发放的座位凭证连接，浏览器通过该服务验证邀请并建立会话。

升级时，启动助手会重新生成专用 Harness 配置。手工安装者请采用随包提供的 `cordis.patch.yml` 或 `cordis.cloudflare.patch.example.yml`，删除旧 `mjai` 和静态 `seats` 字段。旧模块导出也已删除，请使用 `service-control`、`service-spectator` 和 `seat-runtime`。源代码、素材的出处与许可记录继续保留。

## 使用

需要 Node.js 22 或更新版本，以及官方 DeepSeek Harness。默认将两者并排放置：

```
Desktop/
  DeepSeekHarness/app/...
  dsh-mahjong/
```

Harness 在其他位置时设置 `DSH_HARNESS_ROOT`。先在 Harness 配置需要使用的模型，然后在本项目目录执行：

```sh
npm run setup
npm start
```

打开终端显示的本地网址（默认 `http://127.0.0.1:3082/`），点击侧栏「麻将实验室」。macOS 可双击「启动麻将.command」和「停止麻将.command」。

- **开桌**：选择血战到底或标准国标，再配置四席真人/AI。可为每个 AI 选择不同模型；有真人时选定一人为桌主。超时默认 38 秒，可设置 10–120 秒，服务自动选择合法托管动作。模型余额不足或凭据失效时会显示提示，托管仍可继续。
- **初始积分**：每席默认 4,800 分，开桌时可分别设为 0–1,000,000 的整数，开局后固定。牌桌显示当前积分，结算输赢按当前积分减去各自初始积分计算；输分超过初始积分时仍可为负数。旧牌局、旧牌谱保持原值，独立练习使用新开桌设置的积分。
- **真人邀请**：从邀请面板复制座位链接。邀请限一次领取，领取后同一浏览器可刷新恢复；「撤销并换新」会让旧链接与旧连接失效。
- **多个页面打开同一座位**：最新打开的页面接管操作，旧页面会停止自动重连并显示提示；点击「在此页面继续」可主动切回。普通网络断线仍自动重连并同步牌局。
- **问答**：「提问这一步」缩小同一张牌桌并聚焦 Harness 原生输入框。原有取消、审批、追问和模型选择保留。
- **我的牌谱**：查看步骤、导入/导出 JSON，生成 7 天分享链接并管理撤销。导出和分享须等整局结束。
- **从这里练习**：完整服务器记录的有效历史步骤可另开牌局，规则与选项锁定，成绩和记录独立。导入文件和局部录像案例只有展示数据，不能伪造牌墙后续玩。
- **教练课程**：换三张、定缺、清缺弃牌、带幺九四个单步血战基础关卡；目标、提示、反馈和学习进度独立于实战成绩。

血战保留换三张、定缺和原计分。国标采用 `mcr-81-v1`：144 张牌、标准 81 番种、8 番起和，花牌不计起和门槛，可选择自动或手动补花。国标单盘一人合法和牌即结束。未达到门槛的和牌请求由服务拒绝。广东麻将暂不开放。

原 `/hand/` 的牌面、桌布、字体、声音和动画随包提供。画布保持 1280×720 等比居中；容器大小、步骤问答和栏位变化不重建同一牌桌。国标规则说明与计番已同步到标准规则，修改单独记录于来源清单。

## 连接统一托管服务

管理员在「我的牌谱 → 服务使用者管理」生成一次性邀请。使用者安装本项目后运行：

```sh
node scripts/local-test-stack.mjs connect https://你的服务地址
npm start
```

按提示粘贴邀请。凭证仅保存在本地 `.local/connection.json`；过期或撤销后由管理员重新邀请。切换服务或账号时使用独立 Harness 数据目录，避免混用记录。管理员可调整每人保留记录数和同时进行的牌桌数。

## 自行部署 Cloudflare

见 [Cloudflare 部署与维护](docs/cloudflare-deployment.md)。服务由 Worker、静态资源和两个 SQLite Durable Object 类构成；无需另外购买服务器或配置外部数据库。平台有免费额度限制，公开托管的容量取决于实际用量。模型 API 的使用不属于 Cloudflare 免费额度。

## 本地数据与维护

`npm stop` 只停止本启动器管理的进程；`npm run status` 查看运行情况。其他 Harness 实例和原项目不会被关闭。

- `.local/`：本地凭证、独立 Harness 配置/会话、运行记录与日志。
- `service/.dev.vars`：本地服务签名密钥。
- `service/.wrangler/`：本地牌局与用户数据库。备份时同时保留密钥和数据库。
- 模型设置和凭证仅在首次创建独立 Harness 数据目录时从官方安装复制；之后可在该实例中单独修改。
- 远端连接优先使用已有 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境配置；未设置 HTTP/HTTPS 代理环境变量时，macOS 会自动读取系统中启用的 HTTP/HTTPS 代理及例外列表，供服务请求与牌桌 WebSocket 使用。本机回环连接不经过代理。系统代理软件需要保持运行；仅配置 PAC 或 SOCKS 时仍需提供 HTTP/HTTPS 代理环境变量。
- 启动失败会区分云端连接和本地 Harness，并显示网络原因或对应日志路径。云端连接失败时无需重新安装或部署。
- 自定义本地端口：`DSH_MAHJONG_PORT`（Harness）、`DSH_MAHJONG_SERVICE_PORT`（本地牌局服务）。

上述私有数据均不进入 Git 或发布包。不要把自己的私有目录作为模板分发。

## 开发与验证

```sh
npm run check
npm test
npm --prefix frontend run check
npm --prefix service run check
npm --prefix service test
```

服务测试会先构建原前端和 Worker，再运行规则、权限、恢复、回放、练习和真实 WebSocket 集成测试。规则测试包含标准番种正反例、0–4 真人混合局和国标吃碰杠补花。模型实测、浏览器验收与部署结果见 [完成验收记录](docs/product-acceptance.md)。

本次旧后端清理、代码 review、升级边界和回滚说明见 [兼容层移除记录](docs/compatibility-removal.md)。

源码来源及修改分别记录在 `service/source-manifest.json` 和 `docs/hand-parity-manifest.json`。477 项图片、字体和声音保持来源字节一致，保留各自许可；上游代码许可见 `service/licenses/`、`frontend/licenses/`。历史设计与阶段报告保留在 `docs/`，当前实现以本 README 和验收记录为准。支付、课程商城、视频编辑器和自动发布不在本次范围。
