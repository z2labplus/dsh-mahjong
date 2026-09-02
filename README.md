# dsh-mahjong

基于 DeepSeek Harness 的 AI 麻将桌，计划在许可审计完成后开源发布。支持血战到底四人麻将，四个座位可任意混搭真人与 AI，每个 AI 座位由独立的 Harness agent 会话驱动。

An AI Mahjong table for DeepSeek Harness, planned for open-source release after the license audit. It supports four-player Bloody Battle Mahjong with any mix of human and AI seats, with each AI seat driven by an independent Harness agent session.

## 核心原则 / Core principle

牌局必须原样复用 MJLab `/hand/`，包括牌面、桌面、布局、动画、声音、HUD、操作和 1280 x 720 等比缩放规则。项目不会重新绘制或近似实现另一套牌桌。

The game surface must reuse MJLab `/hand/` exactly, including tiles, table, layout, animation, sound, HUD, controls, and the 1280 x 720 proportional scaling contract. This project will not redraw or approximate a second table UI.

## 产品形态 / Product shape

- 默认是两栏：牌桌为主区，AI 对话为侧栏。
- 一栏用于牌桌聚焦，仍可从当前步骤发起提问。
- 三栏在需要会话列表、牌谱或更多上下文时展开。
- 开桌、看牌、对 AI 实时提问都发生在 DeepSeek Harness 内。
- 四个座位公开显示真人或模型身份。

- Two columns by default: the table is primary and AI conversation is secondary.
- One column is a focused table mode with an entry point to ask about the current step.
- Three columns expand sessions, replay, or additional context when needed.
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

1. 验证官方插件能否承载默认两栏布局。
2. 建立 `/hand/` 原样复用与可验证的版本基线。
3. 打通一个 AI 座位完成一次合法动作的最小闭环。
4. 验证 38 秒超时与安全回退。

The project is in M0 technical validation:

1. Verify that the official plugin API can support the default two-column layout.
2. Establish a versioned and verifiable exact-reuse baseline for `/hand/`.
3. Complete the minimum loop for one AI seat to submit one legal action.
4. Verify the 38-second timeout and safe fallback.

## 仓库状态 / Repository status

当前仓库已包含 M0 官方插件骨架与可运行的客户端工作区。已在 DeepSeek Harness `0.1.0-rc.8` 中验证：专用 profile 能加载插件，默认两栏为 70/30，一栏聚焦和三栏会话列表均可切换，牌桌直接载入真实 MJLab `/hand/`。受信父页面消息通道已实现并通过单元测试；真实牌局端到端验证、游戏服务桥接、AI 座位动作和 38 秒权威超时仍在后续 M0 范围内。

The repository now contains a runnable M0 plugin skeleton and client workspace. It has been verified with DeepSeek Harness `0.1.0-rc.8`: the dedicated profile loads the plugin, the default split is 70/30, one-column focus and three-column session-list states work, and the table embeds the real MJLab `/hand/`. Trusted-parent messaging is implemented and unit-tested; real-game end-to-end validation, the game-service bridge, AI-seat action loop, and authoritative 38-second timeout remain in the M0 backlog.

## 许可 / License

许可证尚未选择。MJLab 代码与牌面、声音、纹理等素材可能适用不同许可，完成复用审计前不会复制受限制素材或发布误导性的统一许可证。

No repository license has been selected yet. MJLab code and assets such as tiles, sounds, and textures may use different licenses; restricted assets will not be copied and no misleading umbrella license will be published before the reuse audit is complete.
