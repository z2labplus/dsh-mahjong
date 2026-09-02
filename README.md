# dsh-mahjong

基于 DeepSeek Harness 的 AI 麻将桌，计划在许可审计完成后开源发布。支持血战到底四人麻将，四个座位可任意混搭真人与 AI，每个 AI 座位由独立的 Harness agent 会话驱动。

An AI Mahjong table for DeepSeek Harness, planned for open-source release after the license audit. It supports four-player Bloody Battle Mahjong with any mix of human and AI seats, with each AI seat driven by an independent Harness agent session.

## 核心原则 / Core principle

牌局必须原样复用 MJLab `/hand/`，包括牌面、桌面、布局、动画、声音、HUD、操作和 1280 x 720 等比缩放规则。项目不会重新绘制或近似实现另一套牌桌。

The game surface must reuse MJLab `/hand/` exactly, including tiles, table, layout, animation, sound, HUD, controls, and the 1280 x 720 proportional scaling contract. This project will not redraw or approximate a second table UI.

## 产品形态 / Product shape

- 默认是 Harness 两栏：左侧会话列表，中间为完整原生对话；真实 `/hand/` 以 16:9 无装饰画布悬浮在对话上方。
- “提问这一步”会把同一牌桌缩为紧凑状态并聚焦原生输入框，不重建 iframe，也不丢失牌局。
- 一栏收起会话列表以聚焦当前任务；三栏打开右侧详情；三种状态都复用同一个牌桌实例。
- 悬浮只描述位置关系。牌桌本体没有圆角、边框、阴影、模糊、遮罩或裁切；Harness 控件仍遵循宿主设计系统。
- 开桌、看牌、对 AI 实时提问都发生在 DeepSeek Harness 内。
- 四个座位公开显示真人或模型身份。

- The default Harness layout has two columns: the session list and the complete native conversation, with the real 16:9 `/hand/` surface floating above the conversation.
- "Ask about this move" compacts the same table and focuses the native composer without remounting the iframe or losing game state.
- One column collapses sessions to focus the current task; three columns open details; all states retain the same table instance.
- Floating describes placement only. The table itself has no radius, border, shadow, blur, mask, or crop; Harness controls continue to use the host design system.
- Table setup, play, spectating, and live questions all happen inside DeepSeek Harness.
- Every seat publicly shows whether it is human or which model is playing.

## 架构边界 / Architecture boundary

- 使用 DeepSeek Harness 官方插件机制，不修改 Harness 核心。
- 游戏服务负责唯一可信状态、合法动作、结算和 38 秒默认超时。
- 每个 AI 座位对应独立 agent 会话，玩家问答使用另一条独立会话。
- AI 只能看到自己的暗牌和公共牌局信息，所有返回动作由游戏服务再次校验。

- Uses the official DeepSeek Harness plugin mechanism without modifying Harness core.
- The game service owns authoritative state, legal actions, settlement, and the default 38-second timeout.
- Each AI seat has an independent agent session; player Q&A uses a separate session.
- AI seats see only their own concealed hand and public information, and every returned action is validated by the game service.

## 当前阶段 / Current stage

项目正在进行 M0 技术验证：

1. 验证官方叠加插槽能否在不替换原生对话的情况下承载悬浮牌桌。
2. 建立 `/hand/` 原样复用与可验证的版本基线。
3. 打通一个 AI 座位完成一次合法动作的最小闭环。
4. 验证 38 秒超时与安全回退。

The project is in M0 technical validation:

1. Verify that the official additive overlay slot can host the floating table without replacing native conversation UI.
2. Establish a versioned and verifiable exact-reuse baseline for `/hand/`.
3. Complete the minimum loop for one AI seat to submit one legal action.
4. Verify the 38-second timeout and safe fallback.

## 仓库状态 / Repository status

当前仓库已包含 M0 官方插件骨架与客户端实现。插件通过 `shell.overlay` 添加真实 MJLab `/hand/`，通过会话头部的 additive utility 提供“提问这一步/聚焦牌桌”切换；不接管 Harness 的对话、输入框、审批、提问、停止生成或详情栏。一栏、默认两栏、大小模式、会话切换与原生 composer 已在 Harness `0.1.0-rc.8` 的 1920 x 1080 真实页面通过验收；三栏详情、审批/停止控件、真实牌局端到端、游戏服务桥接、AI 座位动作和 38 秒权威超时仍在 M0 验收范围内。

The repository now contains the M0 official-plugin skeleton and client implementation. It adds the real MJLab `/hand/` through `shell.overlay` and exposes the "ask/focus" switch through an additive session-header utility; it does not replace Harness conversation, composer, approvals, questions, stop controls, or details. One-column, default two-column, size-mode, session-switch, and native-composer behavior have passed live 1920 x 1080 acceptance in Harness `0.1.0-rc.8`; three-column details, approval/stop controls, real-game end-to-end validation, the game-service bridge, AI-seat action loop, and the authoritative 38-second timeout remain in the M0 acceptance scope.

## 许可 / License

许可证尚未选择。MJLab 代码与牌面、声音、纹理等素材可能适用不同许可，完成复用审计前不会复制受限制素材或发布误导性的统一许可证。

No repository license has been selected yet. MJLab code and assets such as tiles, sounds, and textures may use different licenses; restricted assets will not be copied and no misleading umbrella license will be published before the reuse audit is complete.
