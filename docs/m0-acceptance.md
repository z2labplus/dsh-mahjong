# M0 技术验证与验收

> 历史阶段记录：以下“当前”指编写该阶段文档时的状态。最新独立交付与旧兼容入口清理以 [README](../README.md) 和 [移除记录](compatibility-removal.md) 为准。

2026-09-05 范围说明：当前清单继续验收血战到底接入。已确认的“血战模块化 → 国标接入 → 广东等玩法”属于后续扩展，见 [多规则集计划](multi-ruleset-plan.md)；本次文档同步不改变下面的验证进度，不把新玩法计为已实现或已验收。

2026-09-05 最终交付补充：终点是 **DeepSeek Harness + dsh-mahjong 独立运行，不依赖 mjai**。本清单中的 mjai 联调属于过渡阶段；即使 M0 全部通过，也不能代替 [独立交付的干净环境验收](standalone-delivery.md#4-独立交付验收)。本次仅记录要求，未执行迁移、停服或独立运行测试。

## 本阶段回答的问题

1. DeepSeek Harness 0.1.0-rc.8 的官方插件机制能否在不修改核心的情况下承载 dsh-mahjong。
2. `shell.overlay` 能否把真实 `/hand/` 无装饰地悬浮在完整原生对话上方。
3. 同一牌局会话内，一栏、默认两栏和三栏详情能否复用同一个 `/hand/` iframe 与牌局状态。
4. 四席任意真人/AI 混搭能否通过独立 Harness agent 会话，在 38 秒内返回并执行合法动作。

## 不变量

- 游戏服务是唯一可信状态来源。
- Harness agent 只提出动作，不直接改变牌局。
- 服务端只接受当前时点合法、属于当前座位且未超时的动作。
- AI 座位只收到本座暗牌和公共信息。
- `/hand/` 只能按原有 1280 x 720 坐标系整体缩放。
- 真人邀请与全 AI 旁观能力票据只通过 URL fragment 交给 `/hand/`，成功握手后立即从地址栏和当前历史项清理。
- `/hand/` 页面、嵌入 iframe 与插件 API 响应统一使用 `no-referrer`。
- 浏览器调用插件本机 API 必须携带当前服务进程生成的 `requestToken`。
- 可见问答连接在收到与桌型精确匹配的 `DSH_SPECTATING` 授权前，不得暴露任何已缓冲快照；含真人牌局必须为 `self`，全 AI 牌局必须为 `full`，不匹配时丢弃全部缓冲。
- 可见问答状态必须先收到 `full:true` 完整基线，之后才能按 `[kind,key]` 合并增量；`null` 删除、临时集合和凭据类敏感字段必须按约定处理。
- M0 以受信任本机用户、受信任 Harness 页面和受信任已安装插件为边界；恶意本地进程不在防护范围。
- M0 不修改血战规则、结算、推荐排序、支付或账号体系。

## 通过条件

### 插件

- 插件可由官方加载器发现、安装、启动和停止。
- 服务端与客户端 bundle 均通过 Harness 官方扩展点加载。
- 不修改 Harness 安装目录或核心包。

### 布局

- 1920 x 1080 下默认保留 Harness 两栏：会话列表与完整原生对话。
- 牌桌通过 additive `shell.overlay` 悬浮在当前对话上方，不注册或替换任何 single slot。
- 聚焦态在完整 16:9 牌桌能够容纳时与当前对话内容区的上、左、右边界贴合；极端宽矮窗口按 `contain` 居中，不能拉伸或裁切牌桌。
- 聚焦态可拖动左边、右边、下边、左下角和右下角；拖动中上边固定，对边或水平中心固定，始终保持 16:9。桌面基准最小尺寸为 480 x 270，当前栏空间不足时以不越界、不覆盖 composer 为更高优先级。
- “提问这一步”将同一个 16:9 牌桌缩为紧凑状态：默认高度精确取第二栏从内容区顶部到 composer 上沿这段可见高度的 50%，栏宽不足时按 `contain` 收敛；随后聚焦原生 composer。“聚焦牌桌”恢复当前页面、当前牌局会话的手动尺寸。
- 牌桌本体无圆角、边框、阴影、模糊、遮罩或裁切，且不覆盖 composer、审批、`ask_user` 或停止生成控件。
- 同一牌局会话内，一栏、两栏、三栏及牌桌大小切换不重建 iframe，不丢失牌局、问题和回答；普通会话不显示牌桌。
- 若官方扩展点无法实现，M0 以明确阻断结论结束，不采用私有补丁。

### `/hand/` 一致性

- 使用真实 `/hand/` 构建产物或经许可的版本化源快照，不使用仿制 UI。
- 通过 `docs/hand-parity-contract.md` 的视觉与交互检查。
- 所有复用文件都有来源版本、哈希和许可记录。

### AI 最小闭环

- 创建一个 AI 座位会话并提交结构化决策上下文。
- Agent 返回一个动作候选。
- 游戏服务验证并执行合法动作。
- 非法、格式错误、过期和超时响应均被拒绝且有可定位日志。
- 默认超时为 38 秒，回退动作在实现前完成口径确认与正反例测试。
- 每桌新牌局只发送一次插件来源的问答连接上下文与欢迎 turn；恢复、重试和 agent 重建不重复发送，欢迎失败不影响牌桌、运行时或状态工具。
- 问答状态自动化覆盖完整基线、增量覆盖、字段删除、临时集合过滤、敏感字段过滤、授权范围匹配与不匹配正反例。

### 本机安全边界

- `/dsh-mahjong/api` 只接受回环连接、同源浏览器请求和正确的每进程 `requestToken`；任一门禁不满足均拒绝。
- 新生成的真人邀请形如 `/hand/?gameId=G123#seat=2&humanInviteTicket=<短期票据>`，全 AI 旁观形如 `/hand/?gameId=G123#spectatorEmbedTicket=<短期票据>`；查询参数不得携带这些新票据。
- 真人收到服务端成功入座结果、旁观者收到服务端成功旁观结果后，`/hand/` 必须清理 fragment 中的票据与邀请座位；失败响应不得误清理后继续伪装为已授权。
- `/hand/` 文档、宿主 iframe 和插件 API 响应都声明 `no-referrer`；自动化需验证配置存在且 iframe 使用 `referrerPolicy="no-referrer"`。
- 正例至少覆盖正确 `requestToken`、有效 fragment 票据和成功握手清理；反例至少覆盖缺失/错误 `requestToken`、重复或混合票据、过期票据及失败握手不误授权。
- 本节不承诺抵御恶意本地进程、具有页面读取权限的恶意浏览器扩展、被攻陷的 Harness 插件、同用户调试器或管理员级恶意软件。

## M0 交付物

- 独立仓库与可复现安装说明。
- 官方 Harness 插件最小骨架。
- `/hand/` 复用清单与校验脚本。
- 动态四席配置、AI 座位动作闭环及测试。
- 一栏、两栏、三栏的真实运行截图。
- 风险、回滚和下一阶段建议。

## 当前验证进度

- 已通过：官方插件加载，未修改 Harness 核心。
- 已通过：专用 `dsh-mahjong` profile；日常 `web` profile 不包含本插件。
- 已通过：客户端改为 additive `shell.overlay` 与 `conversation.session.header.utilities`，不再接管原生 conversation。
- 已通过：同一 iframe 在大/紧凑状态间只改变 1280:720 几何，不使用 session 或栏模式作为 React key。
- 已通过：聚焦态提供左、右、下边及两个下角共五个宿主拖柄；上边固定，边/角锚点在连续拖动中不跳位，拖动期间不让 iframe 抢走指针，结束、取消、失焦与组件卸载均清理拖动状态。
- 已通过：牌桌外层与 iframe 显式为零圆角、零边框、零阴影、无滤镜、无 mask、无 clip-path。
- 已通过：1920 x 1080 真实 Harness 页面默认两栏；紧凑牌桌实测 `716.44 x 403 px`，比例 `1.77776`，与 composer 无相交。
- 已通过：`1245 x 886` Ego Lite 真实 Harness 视口中，可见牌桌区高 `684 px`，紧凑态实测 `608 x 342 px`，高度精确为 50%，上边距与水平中心偏差均为 `0`，与 composer 无相交。
- 已通过：同一真实 Harness 页面连续拖动五个拖柄；各步顶部均为 `76 px`，对应的当前左边、右边或水平中心保持固定，结束后 `data-resizing` 均已清理，iframe 身份始终不变。手动状态切至紧凑再返回后恢复为拖动前的 `616.109 x 346.547 px` 与原位置。
- 已通过：在 `1261 x 902` Ego Lite 真实 Harness 视口中，一栏为 `56 / 1205 / 0`，牌桌 `1205 x 677.8125 px`；默认两栏为 `280 / 981 / 0`，牌桌 `981 x 551.8125 px`；宿主三栏网格为 `280 / 640 / 341`，牌桌 `640 x 360 px`。三种状态的牌桌上、左、右间距均为 `0`，比例均为 16:9，栏位切换前后 iframe 始终为同一个实例。
- 已通过：同一牌局会话内，大/紧凑状态及一栏、两栏、三栏切换只重算几何，iframe 始终为 1 个且身份标记不变；切换到普通 Harness 会话时牌桌按设计卸载，返回牌局会话后按服务端 session-game 映射恢复同一牌局状态，但不承诺复用离开前的 DOM iframe 实例。
- 已通过：原生 composer 保留且只有 1 个，插件内没有 textarea；“提问这一步”会聚焦原生 composer；运行时无 error，验收期间仅记录到重启专用 Harness 服务所产生的宿主重连 warning。
- 已通过：Harness `0.1.0-rc.8` 的公开 `ctx.layout.openDetails()` 能打开真实三栏网格，收回详情栏后牌桌恢复原尺寸且同会话 iframe 不重建。当前通用工具行的 `Inspect` 行为是切换到「轨迹」视图，而不是打开右侧详情栏；最终面向用户的详情入口仍由 Harness 宿主提供。
- 待完成：停止生成、审批和 `ask_user` 的真实交互验收。
- 已通过：客户端 bundle 和真实 `/hand/` 静态入口均返回 HTTP 200；iframe 响应头未禁止嵌入，`/hand/` 页面与 iframe 均声明 `no-referrer`。
- 已通过：插件只加载回环地址上的真实 `/hand/`；本机桥接只允许同源或回环地址的 `parentOrigin`。`/hand/` 首帧门槛后发送 `mjlabai:hand-ready`，并可响应受信父页面的就绪确认请求；来源解析与请求校验测试通过。
- 已通过：动态模式的 client bootstrap 提供 schema、`gameId:null`、同源 `apiBase` 与每进程 `requestToken`，不下发固定真实牌局 ID。客户端按当前 `sessionId` 请求服务端 session-game 映射；只有已映射的牌局会话获得短期 `/hand/` URL，其中 `gameId` 位于查询参数，真人邀请或旁观能力票据位于 fragment。
- 已实现：插件 API 统一执行回环、同源、浏览器来源与 `requestToken` 门禁，API 响应使用 `Referrer-Policy: no-referrer`；缺失或错误令牌返回 `403 REQUEST_TOKEN_REJECTED`。
- 已实现：`/hand/` 从 fragment 读取真人邀请或旁观票据，只保存在页面内存；服务端成功握手后从地址栏和当前历史项删除票据，页面不写入 localStorage/sessionStorage。
- 已通过：每个 AI 座位使用独立、隐藏且可恢复的 Harness Agent 会话；启动时先读取持久化 header，再明确选择 create 或 resume，元数据冲突直接失败。
- 已通过：AI 私有决策状态不进入持久用户消息，只在当前请求的动态 system section 中提供，决策关闭后清除；座位 Agent 只保留 `submit_mahjong_action` 工具。
- 已通过：38 秒半开截止、合法 actionId 门禁、ACK/重连幂等、永久连接失败状态与服务端 Top1 超时托管均有自动化正反例。
- 已通过：从 Harness 开桌面板创建全 AI 桌，四个隐藏座位会话均进入 ready，真实血战对局完成到终局并可恢复；终局问答准确读取四家定缺、残留轮次、剩余牌数和听牌证据。
- 已通过：MJAI 先发初始完整 `UPDATE`、后发 `DSH_SPECTATING` 的真实协议顺序已兼容；授权前仅缓冲，范围不匹配会丢弃缓冲，授权成功后完整基线与增量共同重建当前状态。
- 已通过：跨端口 iframe 的真实 `hand-ready` 已精确送达 Harness；重启恢复后牌桌状态为 `live`、布局状态为 `ready` 且实际可见。
- 待完成：在一局新的真实对局中单独捕获后续决策通知送达 Harness 的事件证据。
- 已通过：使用真实模型凭据完成四个 Harness AI 座位的合法动作和整局联调。
- 待完成：在真实模型超时场景中实际触发 38 秒权威截止与服务端回退；代码级闭环与自动化正反例已通过。

## 嵌入桥口径

### `mjlabai:hand-ready`

- 白话：牌桌资源、连接、状态同步和首帧都完成后，通知外层 Harness“这局真的可以看了”。
- 项目落点：`/hand/` 嵌入桥的只读就绪事件；插件客户端只接收，不用它提交动作。
- 迷你例子：`{"type":"mjlabai:hand-ready","gameId":"G123","at":"2026-09-02T10:00:00.000Z"}`。
- 收益：避免只凭 iframe `load` 或决策消息误判牌桌已就绪。
- 影响面：只影响加载状态和可观测结果，不影响合法性、状态机、结算或推荐。

### `parentOrigin`

- 白话：牌桌明确知道允许把只读通知发给哪个 Harness 父页面来源。
- 项目落点：`/hand/` 的 `hand-bridge` 传输适配；只用于 `postMessage` 的精确 `targetOrigin`。
- 迷你例子：`parentOrigin=http://127.0.0.1:3081`，父页面同时校验 `event.origin`、`event.source` 与 `gameId`。
- 收益：保持 iframe 跨源隔离，不使用 `"*"`，仍能可靠定位到唯一牌桌实例。
- 影响面：只影响嵌入通信和牌局问答的可见上下文，不改变合法性、状态机、结算、推荐或牌桌视觉。

`parentOrigin` 同时用于 `hand-ready` 和现有的 `hand-decision-context-changed`。后者只能提示 Harness 重新读取已认证的服务端上下文，不能直接提交或执行 AI 动作。

### `mjlabai:hand-ready-request`

- 白话：外层 Harness 主动问牌桌“你是否已经完成首帧并可显示”，用于补偿一次性就绪通知可能早于监听器到达的情况。
- 项目落点：插件在安装消息监听后及 iframe `load` 时发送；`/hand/` 仅在首帧门槛已完成后响应。
- 迷你例子：`{"type":"mjlabai:hand-ready-request","gameId":"G123"}`。
- 收益：消除快速缓存加载下的消息竞态，避免状态永久停在“牌桌页面已载入，等待对局”。
- 影响面：只影响加载状态和可观测结果，不影响合法性、状态机、结算、推荐或牌桌视觉。

M0 不采用 `/hand/` 与 Harness 同源反向代理。原因是同源牌桌脚本可以访问 Harness 父页面 DOM、浏览器存储和根 `/api`，会扩大信任边界；跨源 iframe 加精确来源校验更符合最小权限原则。

### 牌局能力票据

- 白话：`humanInviteTicket` 与 `spectatorEmbedTicket` 是短期、限角色的通行凭证，分别只允许认领一个真人座位或只读旁观一桌全 AI 牌局。
- 项目落点：`lib/game-controller.js` 生成带 fragment 的 `/hand/` URL；MJAI `src/dsh-hand-bootstrap.ts` 解析并清理 URL，`src/hand.ts` 在服务端确认成功后调用 `history.replaceState`。AI 使用的 `seatCredential` 不进入浏览器 URL。
- 迷你例子：`/hand/?gameId=G123#seat=2&humanInviteTicket=<短期票据>`；旁观链接使用 `#spectatorEmbedTicket=<短期票据>`。
- 收益：fragment 不随 HTTP 请求或 Referrer 发送，成功后立即清理又减少地址栏、当前历史项、截图和后续复制暴露。
- 影响面：会影响真人入座和旁观授权，属于核心鉴权行为；必须用有效、无效、重复、混合、过期、已使用票据，以及成功/失败握手清理正反例锁定，不改变麻将规则或结算。

### `requestToken`

- 白话：每次 dsh-mahjong 服务进程启动时生成一个随机值，只允许由该进程交付的 Harness 页面调用插件 API。
- 项目落点：`index.js` 生成并写入 client bootstrap；`client.js` 放入 `X-DSH-Mahjong-Request-Token` 请求头；`lib/http-api.js` 对所有 `/dsh-mahjong/api` 路由统一校验。
- 迷你例子：`X-DSH-Mahjong-Request-Token: <本进程随机值>`；重启后旧值请求得到 `403 REQUEST_TOKEN_REJECTED`。
- 收益：在回环和同源检查之外，阻止未取得当前 Harness 页面 bootstrap 的普通网页或偶然本机请求直接开桌、停止牌局或读取状态。
- 影响面：影响模型目录、状态读取、开桌、重试和停止全部插件 API，属于核心访问门禁；必须测试正确、缺失、错误和旧进程令牌，不改变牌局状态机、动作合法性或结算。

### `no-referrer`

- 白话：页面和嵌入层明确要求浏览器不要把当前来源 URL 作为 Referrer 发给后续请求。
- 项目落点：MJAI `hand/index.html` 的 `<meta name="referrer" content="no-referrer">`、插件 iframe 的 `referrerPolicy="no-referrer"`，以及 `lib/http-api.js` 的 `Referrer-Policy: no-referrer` 响应头。
- 迷你例子：从带 `#humanInviteTicket=...` 的 `/hand/` 加载资源或跳转时，请求不携带该页面 Referrer。
- 收益：与 fragment 和握手后清理共同降低完整牌桌 URL 进入第三方日志、分析系统或后续导航请求的风险。
- 影响面：只影响浏览器来源信息和可观测结果，不改变鉴权判定、麻将规则、状态机或结算；需用页面元信息、iframe 属性和响应头检查锁定。

### M0 受信任本机边界

- 白话：M0 假定这台设备上的登录用户、Harness 页面和已安装插件没有恶意代码。
- 项目落点：插件 API 仅监听/接受回环路径，并叠加同源、浏览器来源与 `requestToken` 校验；这是 Web 与误操作防线，不是本机进程沙箱。
- 迷你例子：普通跨站网页或缺令牌请求会被拒绝；与 Harness 同用户运行且能读取页面或进程内存的恶意程序仍可能取得令牌。
- 收益：明确当前可验证的安全承诺，避免把回环地址或浏览器可见令牌误称为操作系统级认证。
- 影响面：不改变产品行为，但决定威胁模型和验收结论；恶意本地进程、恶意高权限扩展、被攻陷插件、同用户调试器和管理员级恶意软件明确不在 M0 防护范围。

### `session-game mapping`

- 白话：每局牌绑定创建它的可见 Harness 会话，而不是绑定整个插件实例。
- 项目落点：`lib/session-game-store.js` 持久化公开映射；客户端通过 `GET /dsh-mahjong/api/state?sessionId=...` 查询。
- 迷你例子：`sessionId="S123"` 返回该会话的 `gameId="G123"`；普通会话返回 `phase="setup"` 且没有牌桌。
- 收益：支持多个牌局会话共存，避免固定 `gameId` 污染所有会话。
- 影响面：决定牌桌在哪个会话显示；不改变麻将规则、结算或动作合法性。浏览器仅记忆 session ID，不持久化 `gameId`、模型信息或票据。

### `connection-halted`

- 白话：某个 AI 座位遇到不可自动恢复的连接错误，明确告诉宿主“这个座位已经停了”。
- 项目落点：`lib/mjai-seat-runtime.js` 发出该运行事件，`index.js` 从 `readySeatIds` 移除对应座位并更新状态工具。
- 迷你例子：`{"type":"connection-halted","seatId":"G123:1"}`。
- 收益：避免状态工具仍把已经永久失败的座位算作 ready。
- 影响面：只影响连接可观测状态；不改变牌局合法性、结算、超时或回退行为。

### 隐藏座位会话元数据

- 白话：把后台 AI 座位会话标为 Harness 的服务子会话，不混入玩家的普通会话列表。
- 项目落点：创建时写入 `meta.origin="subagent"` 与 `meta.delegationDepth=1`，重启恢复前核对同一组字段。
- 迷你例子：`{"origin":"subagent","delegationDepth":1}`。
- 收益：隔离后台座位会话，并防止配置的 `sessionId` 误接管普通会话。
- 影响面：影响会话展示与恢复门禁，不改变模型决策、牌局状态机、结算或推荐。
