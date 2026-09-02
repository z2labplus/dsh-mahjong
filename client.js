/* dsh-mahjong M0 browser bundle.
 * This deliberately embeds the real MJLab /hand/ page. It does not recreate
 * the Mahjong table in Harness markup.
 */
window.__ModuleLoader__.load({
  id: "dsh-mahjong",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var inject = ["slots", "sessions", "conversation", "layout"];
    var STYLE_ID = "dsh-mahjong-m0-css";
    var DEFAULT_HAND_URL = "http://localhost:1234/hand/";
    var HAND_READY_MESSAGE = "mjlabai:hand-ready";
    var HAND_READY_REQUEST_MESSAGE = "mjlabai:hand-ready-request";
    var EMPTY_COMPOSER = Object.freeze({ draft: "", sending: false, error: "" });
    var MAX_COMPOSER_CACHE_SIZE = 64;
    var COMPOSER_BY_SESSION = new Map();

    var CSS = `
      .dsh-mj-root {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 44px minmax(0, 1fr);
        color: var(--dsw-alias-label-primary, #e8eaed);
        background: var(--dsw-alias-bg-base, #111418);
        overflow: hidden;
      }
      .dsh-mj-toolbar {
        box-sizing: border-box;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l2, #30343a);
        background: var(--dsw-alias-bg-layer-1, #171a1f);
      }
      .dsh-mj-title {
        min-width: 0;
        font-size: 14px;
        font-weight: 650;
        line-height: 20px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsh-mj-toolbar-meta {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--dsw-alias-label-tertiary, #9aa0a8);
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
      }
      .dsh-mj-live-dot {
        width: 6px;
        height: 6px;
        flex: none;
        border-radius: 50%;
        background: var(--dsw-alias-state-warn-primary, #d2a84a);
      }
      .dsh-mj-toolbar-meta[data-status="live"] .dsh-mj-live-dot {
        background: var(--dsw-alias-state-success-primary, #54a36b);
      }
      .dsh-mj-spacer {
        flex: 1 1 auto;
        min-width: 8px;
      }
      .dsh-mj-mode-button,
      .dsh-mj-send,
      .dsh-mj-retry {
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2, #3a3f47);
        border-radius: 6px;
        color: var(--dsw-alias-label-primary, #e8eaed);
        background: var(--dsw-alias-bg-layer-3, #20242a);
        font: inherit;
        cursor: pointer;
      }
      .dsh-mj-mode-button {
        height: 30px;
        padding: 0 10px;
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
      }
      .dsh-mj-mode-button:hover,
      .dsh-mj-retry:hover {
        background: var(--dsw-alias-interactive-bg-hover, #292e35);
      }
      .dsh-mj-mode-button:active,
      .dsh-mj-send:active:not(:disabled),
      .dsh-mj-retry:active {
        transform: translateY(1px);
      }
      .dsh-mj-mode-button:focus-visible,
      .dsh-mj-send:focus-visible,
      .dsh-mj-retry:focus-visible,
      .dsh-mj-input:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary, #4f8bd6);
        outline-offset: 1px;
      }
      .dsh-mj-workspace {
        position: relative;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 7fr) minmax(320px, 3fr);
        overflow: hidden;
      }
      .dsh-mj-workspace[data-assistant-open="false"] {
        grid-template-columns: minmax(0, 1fr) 0;
      }
      .dsh-mj-table {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: #0b1214;
      }
      .dsh-mj-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #0b1214;
      }
      .dsh-mj-frame-loading {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: rgba(255, 255, 255, 0.78);
        background: #0b1214;
        font-size: 13px;
        pointer-events: none;
      }
      .dsh-mj-frame-loading[hidden] {
        display: none;
      }
      .dsh-mj-assistant {
        box-sizing: border-box;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border-left: 1px solid var(--dsw-alias-border-l2, #30343a);
        background: var(--dsw-alias-bg-base, #111418);
        overflow: hidden;
      }
      .dsh-mj-workspace[data-assistant-open="false"] .dsh-mj-assistant {
        visibility: hidden;
        pointer-events: none;
      }
      .dsh-mj-assistant-head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 10px 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l2, #30343a);
      }
      .dsh-mj-assistant-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .dsh-mj-assistant-title {
        color: var(--dsw-alias-label-primary, #e8eaed);
        font-size: 13px;
        font-weight: 650;
        line-height: 18px;
      }
      .dsh-mj-assistant-model {
        color: var(--dsw-alias-label-tertiary, #9aa0a8);
        font-size: 11px;
        line-height: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-mj-thinking {
        margin-left: auto;
        color: var(--dsw-alias-state-business-primary, #6a9fda);
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
      }
      .dsh-mj-messages {
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        overflow-y: auto;
        scrollbar-gutter: stable;
      }
      .dsh-mj-empty {
        margin: auto 0;
        color: var(--dsw-alias-label-tertiary, #9aa0a8);
        font-size: 13px;
        line-height: 20px;
        text-align: center;
      }
      .dsh-mj-message {
        max-width: 92%;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dsh-mj-message[data-role="user"] {
        align-self: flex-end;
      }
      .dsh-mj-message[data-role="assistant"] {
        align-self: flex-start;
      }
      .dsh-mj-message-role {
        color: var(--dsw-alias-label-tertiary, #9aa0a8);
        font-size: 10px;
        line-height: 14px;
      }
      .dsh-mj-message[data-role="user"] .dsh-mj-message-role {
        text-align: right;
      }
      .dsh-mj-message-body {
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l2, #343941);
        border-radius: 6px;
        color: var(--dsw-alias-label-primary, #e8eaed);
        background: var(--dsw-alias-bg-layer-3, #20242a);
        font-size: 13px;
        line-height: 20px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .dsh-mj-message[data-role="user"] .dsh-mj-message-body {
        border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f8bd6) 42%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4f8bd6) 14%, var(--dsw-alias-bg-layer-3, #20242a));
      }
      .dsh-mj-compose {
        box-sizing: border-box;
        display: grid;
        gap: 8px;
        padding: 10px 12px 12px;
        border-top: 1px solid var(--dsw-alias-border-l2, #30343a);
        background: var(--dsw-alias-bg-layer-1, #171a1f);
      }
      .dsh-mj-label {
        color: var(--dsw-alias-label-secondary, #c2c6cc);
        font-size: 11px;
        line-height: 16px;
      }
      .dsh-mj-input {
        box-sizing: border-box;
        width: 100%;
        min-height: 72px;
        max-height: 160px;
        resize: vertical;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l2, #3a3f47);
        border-radius: 6px;
        outline: none;
        color: var(--dsw-alias-label-primary, #e8eaed);
        background: var(--dsw-alias-bg-base, #111418);
        font: inherit;
        font-size: 13px;
        line-height: 20px;
      }
      .dsh-mj-input::placeholder {
        color: var(--dsw-alias-label-tertiary, #8f959d);
      }
      .dsh-mj-input:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }
      .dsh-mj-compose-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-mj-compose-hint {
        min-width: 0;
        flex: 1 1 auto;
        color: var(--dsw-alias-label-tertiary, #9aa0a8);
        font-size: 10px;
        line-height: 14px;
      }
      .dsh-mj-send {
        height: 30px;
        padding: 0 12px;
        border-color: transparent;
        color: var(--dsw-alias-label-primary-foreground, #ffffff);
        background: var(--dsw-alias-button-primary-fill, #3268a8);
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
      }
      .dsh-mj-send:hover:not(:disabled) {
        background: var(--dsw-alias-button-primary-hover, #3b75ba);
      }
      .dsh-mj-send:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      .dsh-mj-error {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--dsw-alias-state-error-primary, #df6d6d);
        font-size: 11px;
        line-height: 16px;
      }
      .dsh-mj-retry {
        flex: none;
        height: 26px;
        padding: 0 8px;
        font-size: 11px;
      }
      @media (max-width: 980px) {
        .dsh-mj-workspace {
          grid-template-columns: minmax(0, 1fr);
        }
        .dsh-mj-assistant {
          position: absolute;
          z-index: 2;
          top: 8px;
          right: 8px;
          bottom: 8px;
          width: min(420px, calc(100% - 16px));
          border: 1px solid var(--dsw-alias-border-l2, #30343a);
          border-radius: 6px;
          box-shadow: var(--dsw-shadow-lv2, 0 18px 44px rgba(0, 0, 0, 0.36));
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-mj-mode-button,
        .dsh-mj-send,
        .dsh-mj-retry {
          transition: none;
        }
      }
    `;

    function installStyles() {
      var existing = document.getElementById(STYLE_ID);
      if (existing) return () => {};
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => style.remove();
    }

    function isTrustedHandUrl(parsed) {
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (parsed.username || parsed.password) return false;

      var path = parsed.pathname.replace(/\/+$/, "") || "/";
      var isLocalDevelopmentOrigin = parsed.origin === "http://localhost:1234" ||
        parsed.origin === "http://127.0.0.1:1234";
      return isLocalDevelopmentOrigin && path === "/hand";
    }

    function safeHandUrl() {
      var candidate = new URLSearchParams(window.location.search).get("dshMahjongHandUrl") ||
        window.__DSH_MAHJONG_HAND_URL__ ||
        DEFAULT_HAND_URL;
      var parsed;
      try {
        parsed = new URL(candidate, window.location.href);
        if (!isTrustedHandUrl(parsed)) parsed = new URL(DEFAULT_HAND_URL);
      } catch (_error) {
        parsed = new URL(DEFAULT_HAND_URL);
      }
      if (parsed.origin !== window.location.origin) {
        parsed.searchParams.set("parentOrigin", window.location.origin);
      }
      return parsed.toString();
    }

    function requestHandReady(frame, frameUrl) {
      if (!frame || !frame.contentWindow) return;
      var frameAddress = new URL(frameUrl);
      var gameId = frameAddress.searchParams.get("gameId");
      if (!gameId) return;
      frame.contentWindow.postMessage({
        type: HAND_READY_REQUEST_MESSAGE,
        gameId: gameId,
      }, frameAddress.origin);
    }

    function updateComposer(refresh, sessionKey, patch) {
      var next = Object.assign({}, COMPOSER_BY_SESSION.get(sessionKey) || EMPTY_COMPOSER, patch);
      COMPOSER_BY_SESSION.delete(sessionKey);
      COMPOSER_BY_SESSION.set(sessionKey, next);
      while (COMPOSER_BY_SESSION.size > MAX_COMPOSER_CACHE_SIZE) {
        COMPOSER_BY_SESSION.delete(COMPOSER_BY_SESSION.keys().next().value);
      }
      refresh((revision) => revision + 1);
    }

    function contentText(content) {
      if (!Array.isArray(content)) return "";
      return content
        .map((block) => {
          if (!block || typeof block !== "object") return "";
          if (block.type === "text" && typeof block.text === "string") return block.text;
          if (block.kind === "text" && typeof block.text === "string") return block.text;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    function visibleMessages(snapshot) {
      var nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
      return nodes
        .map((node) => {
          if (!node || typeof node !== "object") return null;
          if (node.kind === "user" || node.kind === "steering") {
            var userText = contentText(node.content);
            return userText ? { key: "u:" + node.seq, role: "user", text: userText } : null;
          }
          if (node.kind === "assistant") {
            var assistantText = contentText(node.blocks);
            return assistantText ? {
              key: "a:" + node.seq,
              role: "assistant",
              text: assistantText,
              model: node.provenance && node.provenance.model,
            } : null;
          }
          return null;
        })
        .filter(Boolean)
        .slice(-40);
    }

    function latestModel(messages) {
      for (var index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].model) return messages[index].model;
      }
      return "当前 Harness 会话";
    }

    function MahjongWorkspace(props) {
      var sessionId = props.sessionId;
      var snapshot = props.useSession((value) => value);
      var assistantPair = react.useState(true);
      var assistantOpen = assistantPair[0];
      var setAssistantOpen = assistantPair[1];
      var frameStatusPair = react.useState("loading");
      var frameStatus = frameStatusPair[0];
      var setFrameStatus = frameStatusPair[1];
      var composerRevisionPair = react.useState(0);
      var refreshComposer = composerRevisionPair[1];
      var sessionKey = sessionId === undefined ? null : sessionId;
      var composer = COMPOSER_BY_SESSION.get(sessionKey) || EMPTY_COMPOSER;
      var draft = composer.draft;
      var sending = composer.sending;
      var error = composer.error;
      var messagesRef = react.useRef(null);
      var frameRef = react.useRef(null);
      var frameUrl = react.useMemo(safeHandUrl, []);
      var messages = react.useMemo(() => visibleMessages(snapshot), [snapshot]);
      var model = latestModel(messages);
      var running = !!(snapshot && snapshot.running);
      var frameStatusText = frameStatus === "live"
        ? "牌局已连接"
        : frameStatus === "loaded"
          ? "牌桌页面已载入，等待对局"
          : "正在载入牌桌";

      react.useEffect(() => installStyles(), []);

      react.useEffect(() => {
        if (window.__DSH_MAHJONG_SIDEBAR_INITIALIZED__) return;
        window.__DSH_MAHJONG_SIDEBAR_INITIALIZED__ = true;
        props.toggleSidebar();
      }, []);

      react.useEffect(() => {
        var node = messagesRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, [messages.length, running]);

      react.useEffect(() => {
        var frameAddress = new URL(frameUrl);
        var expectedOrigin = frameAddress.origin;
        var expectedGameId = frameAddress.searchParams.get("gameId");
        function onFrameMessage(event) {
          var frame = frameRef.current;
          if (!frame || event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
          var data = event.data;
          if (!data || data.type !== HAND_READY_MESSAGE) return;
          if (!expectedGameId || data.gameId !== expectedGameId) return;
          setFrameStatus("live");
        }
        window.addEventListener("message", onFrameMessage);
        requestHandReady(frameRef.current, frameUrl);
        return () => window.removeEventListener("message", onFrameMessage);
      }, [frameUrl]);

      react.useEffect(() => {
        function onKeyDown(event) {
          if (event.key === "Escape" && assistantOpen) setAssistantOpen(false);
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [assistantOpen]);

      async function submitQuestion() {
        var text = draft.trim();
        if (!text || sessionId === undefined || sending) return;
        var targetSessionKey = sessionKey;
        var ask = props.ask;
        updateComposer(refreshComposer, targetSessionKey, { sending: true, error: "" });
        try {
          await ask(text);
          updateComposer(refreshComposer, targetSessionKey, { draft: "" });
        } catch (cause) {
          updateComposer(refreshComposer, targetSessionKey, {
            error: cause instanceof Error ? cause.message : "发送失败，请重试",
          });
        } finally {
          updateComposer(refreshComposer, targetSessionKey, { sending: false });
        }
      }

      function onComposerKeyDown(event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitQuestion();
        }
      }

      var messageNodes = messages.length > 0
        ? messages.map((message) => react.createElement(
            "article",
            {
              className: "dsh-mj-message",
              "data-role": message.role,
              key: message.key,
            },
            react.createElement(
              "div",
              { className: "dsh-mj-message-role" },
              message.role === "user" ? "你" : (message.model || "牌局助手"),
            ),
            react.createElement("div", { className: "dsh-mj-message-body" }, message.text),
          ))
        : [react.createElement(
            "div",
            { className: "dsh-mj-empty", key: "empty" },
            sessionId
              ? "在这里询问当前牌局，例如：现在谁听牌了？"
              : "请先从左侧选择或创建一个 Harness 会话。",
          )];

      return react.createElement(
        "main",
        { className: "dsh-mj-root", "data-dsh-mahjong": "m0" },
        react.createElement(
          "header",
          { className: "dsh-mj-toolbar" },
          react.createElement("div", { className: "dsh-mj-title" }, "dsh-mahjong"),
          react.createElement(
            "div",
            { className: "dsh-mj-toolbar-meta", "data-status": frameStatus },
            react.createElement("span", { className: "dsh-mj-live-dot", "aria-hidden": "true" }),
            react.createElement("span", null, frameStatusText),
          ),
          react.createElement("div", { className: "dsh-mj-spacer" }),
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-mj-mode-button",
              "aria-pressed": String(assistantOpen),
              onClick: () => setAssistantOpen((value) => !value),
            },
            assistantOpen ? "聚焦牌桌" : "展开对话",
          ),
        ),
        react.createElement(
          "div",
          { className: "dsh-mj-workspace", "data-assistant-open": String(assistantOpen) },
          react.createElement(
            "section",
            { className: "dsh-mj-table", "aria-label": "MJLab 牌桌" },
            react.createElement("iframe", {
              ref: frameRef,
              className: "dsh-mj-frame",
              src: frameUrl,
              title: "MJLab /hand/ 牌局",
              allow: "fullscreen; autoplay",
              onLoad: () => {
                setFrameStatus((current) => current === "live" ? current : "loaded");
                requestHandReady(frameRef.current, frameUrl);
              },
            }),
            react.createElement(
              "div",
              { className: "dsh-mj-frame-loading", hidden: frameStatus !== "loading" },
              "正在载入原版 /hand/ 牌桌",
            ),
          ),
          react.createElement(
            "aside",
            { className: "dsh-mj-assistant", "aria-label": "牌局助手" },
            react.createElement(
              "div",
              { className: "dsh-mj-assistant-head" },
              react.createElement(
                "div",
                { className: "dsh-mj-assistant-copy" },
                react.createElement("div", { className: "dsh-mj-assistant-title" }, "牌局助手"),
                react.createElement("div", { className: "dsh-mj-assistant-model" }, model),
              ),
              running
                ? react.createElement("div", { className: "dsh-mj-thinking", role: "status" }, "思考中")
                : null,
            ),
            react.createElement(
              "div",
              { className: "dsh-mj-messages", ref: messagesRef, "aria-live": "polite" },
              messageNodes,
            ),
            react.createElement(
              "div",
              { className: "dsh-mj-compose" },
              react.createElement("label", { className: "dsh-mj-label", htmlFor: "dsh-mj-question" }, "提问当前牌局"),
              react.createElement("textarea", {
                id: "dsh-mj-question",
                className: "dsh-mj-input",
                value: draft,
                disabled: sessionId === undefined || sending,
                placeholder: sessionId ? "这一步为什么这样打？" : "请先选择 Harness 会话",
                onChange: (event) => updateComposer(refreshComposer, sessionKey, { draft: event.target.value }),
                onKeyDown: onComposerKeyDown,
              }),
              error
                ? react.createElement(
                    "div",
                    { className: "dsh-mj-error", role: "alert" },
                    react.createElement("span", null, error),
                    react.createElement(
                      "button",
                      { type: "button", className: "dsh-mj-retry", onClick: submitQuestion },
                      "重试",
                    ),
                  )
                : null,
              react.createElement(
                "div",
                { className: "dsh-mj-compose-row" },
                react.createElement("div", { className: "dsh-mj-compose-hint" }, "Enter 发送，Shift+Enter 换行"),
                react.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-mj-send",
                    disabled: sessionId === undefined || !draft.trim() || sending,
                    onClick: submitQuestion,
                  },
                  sending ? "发送中" : "发送",
                ),
              ),
            ),
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.slots.inject("conversation", () =>
        ctx.slots.register(
          {
            name: "conversation",
            priority: -1,
            inject: (sessionId) => ({
              toggleSidebar: () => ctx.layout.toggleSidebar(),
              ask: async (text) => {
                if (sessionId === undefined) throw new Error("请先选择 Harness 会话");
                var scoped = ctx.sessions.scope(sessionId);
                var conversation = scoped && scoped.get("conversation");
                if (!conversation) throw new Error("当前会话暂不可用");
                await conversation.send(text);
              },
            }),
          },
          MahjongWorkspace,
        ),
      );
    }

    exports.name = "dsh-mahjong";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
