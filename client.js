/* dsh-mahjong M0 browser bundle.
 * The real MJLab /hand/ page floats above the native Harness conversation.
 * Harness owns the conversation, composer, approvals, questions, and columns.
 */
window.__ModuleLoader__.load({
  id: "dsh-mahjong",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var inject = ["slots"];
    var STYLE_ID = "dsh-mahjong-m0-css";
    var DEFAULT_HAND_URL = "http://localhost:1234/hand/";
    var HAND_READY_MESSAGE = "mjlabai:hand-ready";
    var HAND_READY_REQUEST_MESSAGE = "mjlabai:hand-ready-request";
    var TABLE_RATIO = 1280 / 720;
    var overlayMode = "large";
    var overlayModeListeners = new Set();

    var CSS = `
      .dsh-mj-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none !important;
      }
      .dsh-mj-stage {
        box-sizing: border-box;
        position: fixed;
        display: block;
        margin: 0;
        padding: 0;
        overflow: visible;
        pointer-events: auto;
        border: 0;
        border-radius: 0;
        outline: 0;
        background: transparent;
        box-shadow: none;
        filter: none;
        clip-path: none;
        mask: none;
        visibility: hidden;
      }
      .dsh-mj-overlay[data-active="true"] .dsh-mj-stage[data-layout-ready="true"] {
        visibility: visible;
      }
      .dsh-mj-frame {
        display: block;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: visible;
        border: 0;
        border-radius: 0;
        outline: 0;
        background: transparent;
        box-shadow: none;
        filter: none;
        clip-path: none;
        mask: none;
      }
      .dsh-mj-mode-button {
        box-sizing: border-box;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--dsw-alias-border-l2, #3a3f47);
        border-radius: 6px;
        color: var(--dsw-alias-label-primary, #e8eaed);
        background: var(--dsw-alias-bg-layer-3, #20242a);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
        cursor: pointer;
      }
      .dsh-mj-mode-button:hover {
        background: var(--dsw-alias-interactive-bg-hover, #292e35);
      }
      .dsh-mj-mode-button:active {
        transform: translateY(1px);
      }
      .dsh-mj-mode-button:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary, #4f8bd6);
        outline-offset: 1px;
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-mj-mode-button {
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

    function getOverlayMode() {
      return overlayMode;
    }

    function subscribeOverlayMode(listener) {
      overlayModeListeners.add(listener);
      return () => overlayModeListeners.delete(listener);
    }

    function setOverlayMode(nextMode) {
      if (nextMode !== "large" && nextMode !== "compact") return;
      if (overlayMode === nextMode) return;
      overlayMode = nextMode;
      overlayModeListeners.forEach((listener) => listener());
    }

    function useOverlayMode() {
      return react.useSyncExternalStore(
        subscribeOverlayMode,
        getOverlayMode,
        getOverlayMode,
      );
    }

    function isTrustedHandUrl(parsed) {
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (parsed.username || parsed.password) return false;

      var path = parsed.pathname;
      var isLocalDevelopmentOrigin = parsed.origin === "http://localhost:1234" ||
        parsed.origin === "http://127.0.0.1:1234";
      return isLocalDevelopmentOrigin && (path === "/hand" || path === "/hand/");
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
      parsed.searchParams.set("parentOrigin", window.location.origin);
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

    function calculateStageGeometry(scroller, composer, mode) {
      var scrollRect = scroller.getBoundingClientRect();
      var composerRect = composer ? composer.getBoundingClientRect() : null;
      var usableBottom = composerRect
        ? Math.min(scrollRect.bottom, Math.max(scrollRect.top, composerRect.top))
        : scrollRect.bottom;
      var usableHeight = Math.max(0, usableBottom - scrollRect.top);
      var horizontalInset = Math.max(12, Math.min(24, scrollRect.width * 0.02));
      var topInset = 12;
      var lowerReserve = mode === "compact"
        ? Math.max(160, usableHeight * 0.48)
        : Math.max(52, Math.min(96, usableHeight * 0.12));
      var widthLimit = Math.max(0, scrollRect.width - horizontalInset * 2);
      var heightLimit = Math.max(0, usableHeight - topInset - lowerReserve);

      if (mode === "compact") {
        heightLimit = Math.min(heightLimit, usableHeight * 0.46);
      }

      var height = Math.floor(Math.min(heightLimit, widthLimit / TABLE_RATIO));
      if (height < 1) return null;
      var width = height * TABLE_RATIO;

      return {
        left: scrollRect.left + (scrollRect.width - width) / 2,
        top: scrollRect.top + topInset,
        width: width,
        height: height,
      };
    }

    function applyStageGeometry(stage, geometry) {
      if (!geometry) {
        stage.removeAttribute("data-layout-ready");
        return;
      }
      stage.style.left = geometry.left + "px";
      stage.style.top = geometry.top + "px";
      stage.style.width = geometry.width + "px";
      stage.style.height = geometry.height + "px";
      stage.setAttribute("data-layout-ready", "true");
    }

    function FloatingMahjongTable(props) {
      var currentSessionId = props.useSessions((state) => state.current);
      var active = currentSessionId !== undefined && currentSessionId !== null;
      var mode = useOverlayMode();
      var frameStatusPair = react.useState("loading");
      var frameStatus = frameStatusPair[0];
      var setFrameStatus = frameStatusPair[1];
      var rootRef = react.useRef(null);
      var stageRef = react.useRef(null);
      var frameRef = react.useRef(null);
      var frameUrl = react.useMemo(safeHandUrl, []);

      react.useLayoutEffect(() => installStyles(), []);

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

      react.useLayoutEffect(() => {
        var root = rootRef.current;
        var stage = stageRef.current;
        if (!root || !stage) return;
        var shellOverlay = root.closest("[data-shell-overlay]");
        var appFrame = shellOverlay && shellOverlay.parentElement;
        if (!appFrame) return;

        var resizeObserver = new ResizeObserver(scheduleSync);
        var frameMutationObserver = new MutationObserver(startTransitionSampling);
        var contentMutationObserver = new MutationObserver(scheduleSync);
        var observedScroller = null;
        var observedComposer = null;
        var scheduledFrame = null;
        var transitionFrame = null;
        var sampleUntil = 0;

        function replaceObservedTarget(target, previous) {
          if (previous && previous !== target) resizeObserver.unobserve(previous);
          if (target && target !== previous) resizeObserver.observe(target);
          return target;
        }

        function sync() {
          scheduledFrame = null;
          var scroller = appFrame.querySelector("[data-conversation-scroll]");
          var composer = appFrame.querySelector("[data-composer-seat]");
          observedScroller = replaceObservedTarget(scroller, observedScroller);
          observedComposer = replaceObservedTarget(composer, observedComposer);
          if (!active || !scroller) {
            stage.removeAttribute("data-layout-ready");
            return;
          }
          applyStageGeometry(stage, calculateStageGeometry(scroller, composer, mode));
        }

        function scheduleSync() {
          if (scheduledFrame !== null) return;
          scheduledFrame = requestAnimationFrame(sync);
        }

        function sampleTransition() {
          transitionFrame = null;
          sync();
          if (performance.now() < sampleUntil) {
            transitionFrame = requestAnimationFrame(sampleTransition);
          }
        }

        function startTransitionSampling() {
          sampleUntil = performance.now() + 420;
          if (transitionFrame === null) {
            transitionFrame = requestAnimationFrame(sampleTransition);
          }
        }

        function onGridTransitionRun(event) {
          if (event.target !== appFrame || event.propertyName !== "grid-template-columns") return;
          startTransitionSampling();
        }

        function onGridTransitionEnd(event) {
          if (event.target !== appFrame || event.propertyName !== "grid-template-columns") return;
          scheduleSync();
        }

        function onFocusIn(event) {
          var target = event.target;
          if (target instanceof Element && target.closest("[data-composer-seat]")) {
            setOverlayMode("compact");
          }
        }

        resizeObserver.observe(appFrame);
        var initialScroller = appFrame.querySelector("[data-conversation-scroll]");
        if (initialScroller) {
          contentMutationObserver.observe(initialScroller.parentElement || initialScroller, {
            childList: true,
            subtree: true,
          });
        }
        frameMutationObserver.observe(appFrame, {
          attributes: true,
          attributeFilter: [
            "style",
            "data-sidebar-collapsed",
            "data-details-collapsed",
            "data-dragging",
          ],
        });
        appFrame.addEventListener("transitionrun", onGridTransitionRun);
        appFrame.addEventListener("transitionend", onGridTransitionEnd);
        appFrame.addEventListener("focusin", onFocusIn, true);
        sync();

        return () => {
          resizeObserver.disconnect();
          frameMutationObserver.disconnect();
          contentMutationObserver.disconnect();
          appFrame.removeEventListener("transitionrun", onGridTransitionRun);
          appFrame.removeEventListener("transitionend", onGridTransitionEnd);
          appFrame.removeEventListener("focusin", onFocusIn, true);
          if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
          if (transitionFrame !== null) cancelAnimationFrame(transitionFrame);
        };
      }, [active, mode, currentSessionId]);

      return react.createElement(
        "div",
        {
          ref: rootRef,
          className: "dsh-mj-overlay",
          "data-dsh-mahjong-overlay": "m0",
          "data-active": String(active),
          "data-mode": mode,
          "data-frame-status": frameStatus,
        },
        react.createElement(
          "section",
          {
            ref: stageRef,
            className: "dsh-mj-stage",
            "data-dsh-mahjong-stage": "true",
            "aria-label": "MJLab 牌桌",
            "aria-busy": frameStatus === "loading",
          },
          react.createElement("iframe", {
            ref: frameRef,
            className: "dsh-mj-frame",
            "data-dsh-mahjong-frame": "true",
            src: frameUrl,
            title: "MJLab /hand/ 牌局",
            allow: "fullscreen; autoplay",
            onLoad: () => {
              setFrameStatus((current) => current === "live" ? current : "loaded");
              requestHandReady(frameRef.current, frameUrl);
            },
          }),
        ),
      );
    }

    function focusNativeComposer() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        var input = document.querySelector(
          "[data-composer-seat] textarea, [data-composer-seat] [contenteditable=\"true\"]",
        );
        if (input && typeof input.focus === "function") input.focus();
      }));
    }

    function MahjongModeUtility() {
      var mode = useOverlayMode();
      var compact = mode === "compact";

      function onClick() {
        if (compact) {
          setOverlayMode("large");
          return;
        }
        setOverlayMode("compact");
        focusNativeComposer();
      }

      return react.createElement(
        "button",
        {
          type: "button",
          className: "dsh-mj-mode-button",
          "data-dsh-mahjong-toggle": "true",
          "aria-pressed": compact,
          "aria-label": compact ? "聚焦牌桌" : "提问这一步",
          onClick: onClick,
        },
        compact ? "聚焦牌桌" : "提问这一步",
      );
    }

    function apply(ctx) {
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-mahjong-hand",
            order: 100,
          },
          FloatingMahjongTable,
        ),
      );
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "dsh-mahjong-toggle",
            order: 80,
            label: "牌桌显示",
          },
          MahjongModeUtility,
        ),
      );
    }

    exports.name = "dsh-mahjong";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
