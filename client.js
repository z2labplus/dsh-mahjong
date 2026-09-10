/* dsh-mahjong browser bundle. The native Harness conversation remains the
 * only conversation surface; this plugin adds setup and the real /hand/ view. */
window.__ModuleLoader__.load({
  id: "dsh-mahjong",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var inject = ["slots", "sessions", "workspaces", "connection"];
    var STYLE_ID = "dsh-mahjong-client-css";
    // MJLab.ai brand asset, embedded unchanged from frontend/img/icon-96.auto.png.
    var MJLAB_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAACXBIWXMAAAFiAAABYgFfJ9BTAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAABFxJREFUeJztnctr3FUUgL8zryCtQRFsBFEnabCKIOjCRDcVWgcKddeCuDKCVZEuRFvzMkxpHlRXlYoU0z/ArJvYiaVutLgRBQuCSQNtpcWF2lComZnMcVGEzGBLMvObe27a8+3unXvPOcM3c+fe+c1DVBXHjpR1Afc6LsAYF2CMCzDGBRjjAoxxAca4AGNcgDEuwBgXYIwLMMYFGOMCjHEBxrgAY1yAMS7AmEyoRGeHnnqoSvkzEfYCW0Pl3SDLgnxdy628Uxi7/GeIhMEErEp5XOC1UPmapFPR/VLO/g0cCJEw5BLUHzBXi8iLoTKFFJALmKtVgq0MwRI1Uq3UHtlzbOmaVf61zB7Kd2WyqasWuX0XZIwLMMYFGGMqoDTS83rSMb8tvpyZH+nel3TcdmH7DFDenR/a/lKSIcsrlz5Q5LkkY7YT4yVIUir65dzB3o4kopVGn8gjjCQRKxQxvAbsSG2tHW45ioiwmj4JbGm9pHDEIAARhueGep9uJUZpMD+AsCupmkIRhQAglxadLhalqXpmD+W7EPkk6aJCEIsAQPv6K91vNzMzk00fBx5MuKAgRCQAUCbnDvc+upEp80Pdr4Jumm1nI3EJgM50pvb5egfPFXs7VeREOwtqN7EJANh7Zrh7/3oGpsu1KWBDz5jYiFEAghw/Pfj4Hdf0b0byfQS6aNJOohQAbMumM7fd1cwUn8mppqaJt/51E+8dUAbOjPb8777+gcrNYYWWzg2xEK8AEKlxsvRhV93JtjSU36FK6yfnSIhNwD8N7bx2bPn4v0axKClETgGN7x01zts0xCbgFHBlbYco75cGtz8P0F/peQ+k/uK+MAvyU7gSkyUuAcKyQuNpOENap88OPtmN6tGG25ZBmjo9x0JcAoDC+OJpkJm6TuXZ1VT1e+D+un5h8JWjC5cDlpc40QkAqFZWDwJ/NXRva2j/cD578YtAJbWNKAXsObZ0TdBDdxhS1nTqzbExrQUrqk1EKQBg98TSNHDuNjdPFI78diFkPe0iWgGoqtbkLeBmfT8Xrufum7QpKnniFQAUJhcWUI6s6aoJcmDf2C9ls6ISJmoBALmOxz4FfrzV0hO7Jxa+My0oYaIXsHPsXFVXdQC4lFqVUet6kiZ6AQCFqYs/Vyu1F3ZNLV63riVpNoUAuLU1ta6hHWwaAXcrLsAYF2CMCzDGBRjjAowx+5JeW1HZOT/cM7Xe4ZlcSjH6Ce27UwDap9C33tECf1j9hLkvQca4AGNMlyBFfxUhu6b9exJxNjxf5Qbow83ObwVTAYXxxTdiiOPflL+HcQHGuABjXIAxLsAYF2CMCzDG7ByQyaauloZ7rNLXkcnaPQ5DZq4GzNUawkqoVOEEiJwPlqtVlGAf/gomQLMrHwnyFbAcKmcT3ACZ0Vw52AfAxP/M0xbfBRnjAoxxAca4AGNcgDEuwBgXYIwLMMYFGOMCjHEBxrgAY1yAMS7AGBdgjAswxgUY4wKM+RcFhPZ7+dFlOAAAAABJRU5ErkJggg==";
    var STORAGE_KEY = "dsh-mahjong.client-state.v1";
    var STORAGE_SCHEMA = "dsh-mahjong.client-state.v1";
    var CLIENT_BOOT = window.__DSH_MAHJONG_BOOT__;
    var API_BASE = CLIENT_BOOT && typeof CLIENT_BOOT.apiBase === "string"
      ? CLIENT_BOOT.apiBase
      : "/dsh-mahjong/api";
    var API_REQUEST_TOKEN = CLIENT_BOOT && typeof CLIENT_BOOT.requestToken === "string"
      ? CLIENT_BOOT.requestToken
      : "";
    var HAND_READY_MESSAGE = "mjlabai:hand-ready";
    var HAND_READY_REQUEST_MESSAGE = "mjlabai:hand-ready-request";
    var TABLE_RATIO = 1280 / 720;
    var overlayMode = "large";
    var overlayModeListeners = new Set();
    var DEFAULT_FOCUS_RESIZE_PREFERENCE = { scale: 1, align: "center", position: 0.5 };
    var focusResizePreferences = new Map();
    var focusResizeListeners = new Set();

    var CSS = `
      [data-dsh-source-editing] .dsh-mj-resize-handle{display:none}
      .dsh-mj-correction{position:fixed;z-index:80;right:12px;top:134px;bottom:12px;width:min(600px,46vw);display:flex;flex-direction:column;box-sizing:border-box;color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:6px;pointer-events:auto;font-size:13px;line-height:1.6;box-shadow:0 3px 12px #00000012}
      .dsh-mj-correction *{box-sizing:border-box}.dsh-mj-correction header,.dsh-mj-correction footer{padding:12px 16px;flex-shrink:0}.dsh-mj-correction header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.dsh-mj-correction header strong{font-size:16px}.dsh-mj-correction small{display:block;color:var(--dsw-alias-label-secondary,#656b75)}
      .dsh-mj-correction button,.dsh-mj-correction select,.dsh-mj-correction input{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:5px;min-height:32px;padding:4px 8px;max-width:100%}.dsh-mj-correction button{cursor:pointer;white-space:nowrap}.dsh-mj-correction button:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}.dsh-mj-correction button:disabled{opacity:.45;cursor:default}.dsh-mj-correction :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3168d8);outline-offset:2px}
      .dsh-mj-correction nav{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);flex-wrap:wrap}.dsh-mj-correction nav button{border:0;background:transparent}.dsh-mj-correction nav button[aria-pressed=true]{color:var(--dsw-alias-brand-primary,#3168d8);background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}
      .dsh-edit-body{overflow:auto;min-height:0;flex:1;padding:12px 16px}.dsh-edit-body>details{border-top:1px solid var(--dsw-alias-border-l2,#ddd);padding:12px 0}.dsh-mj-correction details summary{cursor:pointer;font-weight:550}.dsh-mj-correction details details{padding:8px 0}.dsh-mj-correction h3{font-size:13px;margin:16px 0 6px}.dsh-mj-correction p{margin:8px 0}.dsh-edit-field{display:flex;flex-direction:column;gap:4px;min-width:0;margin:6px 0}.dsh-edit-field>span{font-size:12px;color:var(--dsw-alias-label-secondary,#656b75)}.dsh-edit-field input,.dsh-edit-field select{width:100%}.dsh-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}.dsh-edit-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}.dsh-edit-transfer{display:grid;grid-template-columns:1fr 1fr 70px auto;gap:6px;align-items:end}.dsh-edit-transfer>button{margin-bottom:6px}
      .dsh-edit-tiles{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:5px;padding:6px 10px;margin:12px 0}.dsh-edit-tiles legend{font-size:12px}.dsh-edit-tiles button{font-size:12px;min-height:29px;padding:2px 5px}.dsh-edit-content{padding:0;border:0;margin:0;min-width:0}.dsh-edit-muted,.dsh-edit-context{color:var(--dsw-alias-label-secondary,#656b75);font-size:12px}.dsh-edit-errors{border-left:3px solid #b64332;padding:8px 12px;background:#b6433208}.dsh-edit-errors strong{color:#a63225}.dsh-edit-diffs p,.dsh-edit-path{overflow-wrap:anywhere;font-size:12px}.dsh-edit-diffs details{padding:6px 0}.dsh-edit-version{border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);padding:12px 0}.dsh-mj-correction video{width:100%;display:block;margin:10px 0}.dsh-mj-correction footer{border-top:1px solid var(--dsw-alias-border-l2,#ddd)}.dsh-mj-correction footer p{font-size:12px;margin:0 0 8px}.dsh-mj-correction button.dsh-edit-primary{color:#fff;background:var(--dsw-alias-brand-primary,#3168d8);border-color:transparent}.dsh-mj-correction button.dsh-edit-primary:disabled{background:#7a8ba8}
      @media(max-width:999px){.dsh-mj-correction{width:calc(100vw - 24px);top:46vh;bottom:12px}.dsh-mj-correction header{padding:8px 12px}.dsh-edit-grid{grid-template-columns:1fr 1fr}}

      .dsh-mj-overlay{position:fixed;inset:0;z-index:20;pointer-events:none!important}
      .dsh-mj-stage{box-sizing:border-box;position:fixed;display:block;margin:0;padding:0;overflow:visible;pointer-events:auto;border:0;border-radius:0;outline:0;background:transparent;box-shadow:none;filter:none;clip-path:none;mask:none;visibility:hidden}
      .dsh-mj-stage[data-frame-status="live"][data-layout-ready="true"],.dsh-mj-stage[data-frame-status="error"][data-layout-ready="true"]{visibility:visible}
      .dsh-mj-frame{display:block;width:100%;height:100%;margin:0;padding:0;overflow:visible;border:0;border-radius:0;outline:0;background:transparent;box-shadow:none;filter:none;clip-path:none;mask:none}
      .dsh-mj-stage[data-resizing="true"] .dsh-mj-frame{pointer-events:none;user-select:none}
      .dsh-mj-resize-handle{position:absolute;z-index:3;display:block;margin:0;padding:0;border:0;border-radius:4px;outline:0;background:transparent;touch-action:none;user-select:none}
      .dsh-mj-resize-handle::after{position:absolute;display:block;content:"";background:var(--dsw-alias-brand-primary,#3168d8);opacity:0;transition:opacity .12s ease}
      .dsh-mj-stage:hover .dsh-mj-resize-handle::after{opacity:.58}
      .dsh-mj-resize-handle:hover::after,.dsh-mj-resize-handle:focus-visible::after,.dsh-mj-stage[data-resizing="true"] .dsh-mj-resize-handle::after{opacity:1}
      .dsh-mj-resize-handle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3168d8);outline-offset:1px}
      .dsh-mj-resize-left,.dsh-mj-resize-right{top:calc(50% - 36px);width:14px;height:72px;cursor:ew-resize}
      .dsh-mj-resize-left{left:0}.dsh-mj-resize-right{right:0}
      .dsh-mj-resize-left::after,.dsh-mj-resize-right::after{top:19px;width:3px;height:34px;border-radius:2px}
      .dsh-mj-resize-left::after{left:5px}.dsh-mj-resize-right::after{right:5px}
      .dsh-mj-resize-bottom{bottom:-7px;left:calc(50% - 36px);width:72px;height:14px;cursor:ns-resize}
      .dsh-mj-resize-bottom::after{bottom:5px;left:19px;width:34px;height:3px;border-radius:2px}
      .dsh-mj-resize-bottom-left,.dsh-mj-resize-bottom-right{bottom:-8px;width:22px;height:22px}
      .dsh-mj-resize-bottom-left{left:0;cursor:nesw-resize}.dsh-mj-resize-bottom-right{right:0;cursor:nwse-resize}
      .dsh-mj-resize-bottom-left::after,.dsh-mj-resize-bottom-right::after{bottom:5px;width:11px;height:11px;border-bottom:3px solid var(--dsw-alias-brand-primary,#3168d8);background:transparent}
      .dsh-mj-resize-bottom-left::after{left:5px;border-left:3px solid var(--dsw-alias-brand-primary,#3168d8)}.dsh-mj-resize-bottom-right::after{right:5px;border-right:3px solid var(--dsw-alias-brand-primary,#3168d8)}
      .dsh-mj-frame-error{box-sizing:border-box;display:flex;width:100%;height:100%;align-items:center;justify-content:center;color:var(--dsw-alias-state-error-primary,#d84a4a);background:var(--dsw-alias-bg-layer-1,#fff);font-size:13px}
      .dsh-mj-mode-button{box-sizing:border-box;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:6px;color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-button-elevated-fill,#fff);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
      .dsh-mj-mode-button:hover,.dsh-mj-sidebar-entry:hover,.dsh-mj-secondary:hover,.dsh-mj-kind-button:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}
      .dsh-mj-mode-button:active,.dsh-mj-sidebar-entry:active,.dsh-mj-primary:active,.dsh-mj-secondary:active{transform:translateY(1px)}
      .dsh-mj-mode-button:focus-visible,.dsh-mj-sidebar-entry:focus-visible,.dsh-mj-primary:focus-visible,.dsh-mj-secondary:focus-visible,.dsh-mj-icon-button:focus-visible,.dsh-mj-kind-button:focus-visible,.dsh-mj-input:focus-visible,.dsh-mj-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3168d8);outline-offset:2px}
      .dsh-mj-sidebar-entry{box-sizing:border-box;display:flex;width:100%;min-width:0;height:36px;align-items:center;gap:9px;padding:0 10px;border:0;border-radius:6px;color:var(--dsw-alias-label-primary,#17191c);background:transparent;font:inherit;font-size:14px;line-height:20px;cursor:pointer}
      .dsh-mj-sidebar-entry[data-wide="false"]{width:36px;padding:0;justify-content:center}
      .dsh-mj-brand-logo{display:inline-flex;width:22px;height:22px;flex:none;align-items:center;justify-content:center}
      .dsh-mj-brand-logo img{display:block;width:34px;height:34px;max-width:none;flex:none;object-fit:contain}
      .dsh-mj-sidebar-label{min-width:0;flex:1;overflow:hidden;text-align:left;text-overflow:ellipsis;white-space:nowrap}
      header:has([data-dsh-source-controls]) [class*="_titleRow"]{flex-wrap:wrap;gap:8px;min-width:0}
      header:has([data-dsh-source-controls]) [class*="_headerUtilities"]{width:100%;max-width:100%;min-width:0;flex-wrap:wrap;align-items:flex-start}
      [data-dsh-source-controls]{flex:1 1 520px;min-width:0}
      .dsh-mj-sidebar-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-state-success-primary,#32a866)}
      .dsh-mj-dialog-layer{position:fixed;inset:0;z-index:2;display:flex;box-sizing:border-box;align-items:center;justify-content:center;padding:24px;pointer-events:auto;background:rgba(8,10,14,.48)}
      .dsh-mj-dialog{box-sizing:border-box;width:min(860px,calc(100vw - 48px));max-height:min(820px,calc(100vh - 48px));overflow:auto;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:6px;color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 18px 60px rgba(0,0,0,.24)}
      .dsh-mj-dialog.dsh-mj-invite-dialog{width:min(640px,calc(100vw - 48px))}.dsh-mj-invite-list{display:grid;gap:10px;padding:20px 24px 24px}.dsh-mj-invite-row{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:8px;align-items:center}.dsh-mj-invite-seat{font-size:13px;font-weight:620}.dsh-mj-invite-url{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px}.dsh-mj-invite-help{margin:0;color:var(--dsw-alias-label-secondary,#656b75);font-size:12px;line-height:18px}.dsh-mj-copy-status{min-height:18px;color:var(--dsw-alias-state-success-primary,#238858);font-size:12px;line-height:18px}
      .dsh-mj-dialog-header{position:sticky;top:0;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 24px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,#e8e9ec);background:var(--dsw-alias-bg-layer-1,#fff)}
      .dsh-mj-title-group{display:flex;min-width:0;align-items:center;gap:12px}.dsh-mj-dialog-title{margin:0;font-size:18px;font-weight:650;line-height:26px}.dsh-mj-dialog-subtitle{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#656b75);font-size:12px;line-height:18px}
      .dsh-mj-icon-button{display:inline-flex;width:30px;height:30px;flex:none;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary,#656b75);background:transparent;cursor:pointer}.dsh-mj-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}
      .dsh-mj-form{padding:20px 24px 24px}.dsh-mj-form-grid{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:14px;align-items:end}.dsh-mj-field{display:grid;min-width:0;gap:7px}.dsh-mj-label{color:var(--dsw-alias-label-secondary,#656b75);font-size:12px;font-weight:550;line-height:18px}
      .dsh-mj-input,.dsh-mj-select{box-sizing:border-box;width:100%;height:38px;min-width:0;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:5px;color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:13px}.dsh-mj-timeout{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-variant-numeric:tabular-nums}
      .dsh-mj-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:22px 0 10px}.dsh-mj-section-heading h3{margin:0;font-size:14px;font-weight:620;line-height:22px}.dsh-mj-section-heading span{color:var(--dsw-alias-label-tertiary,#8a9099);font-size:12px}
      .dsh-mj-seats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dsh-mj-seat{box-sizing:border-box;min-width:0;padding:13px;border:1px solid var(--dsw-alias-border-l3,#e8e9ec);border-top:3px solid var(--seat-accent,#6680a8);border-radius:5px;background:var(--dsw-alias-bg-module-platform,#f8f9fa)}
      .dsh-mj-seat:nth-child(1){--seat-accent:#4d78d0}.dsh-mj-seat:nth-child(2){--seat-accent:#c66a4a}.dsh-mj-seat:nth-child(3){--seat-accent:#3c9a78}.dsh-mj-seat:nth-child(4){--seat-accent:#8b68c4}
      .dsh-mj-seat-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}.dsh-mj-seat-name{display:flex;min-width:0;align-items:center;gap:7px;font-size:13px;font-weight:620}.dsh-mj-kind-group{display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover,#eef0f3)}
      .dsh-mj-kind-button{height:26px;padding:0 9px;border:0;border-radius:4px;color:var(--dsw-alias-label-secondary,#656b75);background:transparent;font:inherit;font-size:12px;cursor:pointer}.dsh-mj-kind-button[aria-pressed="true"]{color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(0,0,0,.08)}
      .dsh-mj-model-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.dsh-mj-model-badge{display:inline-flex;max-width:130px;height:24px;align-items:center;padding:0 8px;overflow:hidden;border-radius:4px;color:var(--seat-accent,#4d78d0);background:color-mix(in srgb,var(--seat-accent,#4d78d0) 12%,transparent);font-size:11px;font-weight:600;line-height:24px;text-overflow:ellipsis;white-space:nowrap}.dsh-mj-human-note{min-height:38px;display:flex;align-items:center;color:var(--dsw-alias-label-secondary,#656b75);font-size:12px;line-height:18px}
      .dsh-mj-notice,.dsh-mj-error,.dsh-mj-catalog-state{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding:10px 11px;border-radius:5px;font-size:12px;line-height:18px}.dsh-mj-notice,.dsh-mj-catalog-state{color:var(--dsw-alias-label-secondary,#656b75);background:var(--dsw-alias-bg-module-platform,#f8f9fa)}.dsh-mj-error{color:var(--dsw-alias-state-error-primary,#d84a4a);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d84a4a) 9%,transparent)}
      .dsh-mj-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:20px}.dsh-mj-primary,.dsh-mj-secondary{display:inline-flex;min-width:86px;height:36px;align-items:center;justify-content:center;gap:7px;padding:0 14px;border-radius:5px;font:inherit;font-size:13px;font-weight:560;cursor:pointer}.dsh-mj-primary{border:1px solid transparent;color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#3168d8)}.dsh-mj-primary:hover{background:var(--dsw-alias-button-primary-hover,#285bbf)}.dsh-mj-secondary{border:1px solid var(--dsw-alias-border-l2,#d9dce1);color:var(--dsw-alias-label-primary,#17191c);background:var(--dsw-alias-button-elevated-fill,#fff)}
      .dsh-mj-primary:disabled,.dsh-mj-secondary:disabled,.dsh-mj-kind-button:disabled,.dsh-mj-select:disabled,.dsh-mj-input:disabled{cursor:not-allowed;opacity:.52}.dsh-mj-spinner{width:13px;height:13px;flex:none;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dsh-mj-spin .8s linear infinite}@keyframes dsh-mj-spin{to{transform:rotate(360deg)}}
      @media(max-width:720px){.dsh-mj-dialog-layer{padding:12px}.dsh-mj-dialog,.dsh-mj-dialog.dsh-mj-invite-dialog{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}.dsh-mj-dialog-header{padding:17px 16px 13px}.dsh-mj-form,.dsh-mj-invite-list{padding:16px}.dsh-mj-form-grid,.dsh-mj-seats,.dsh-mj-invite-row{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.dsh-mj-mode-button,.dsh-mj-sidebar-entry,.dsh-mj-primary,.dsh-mj-secondary,.dsh-mj-resize-handle::after{transition:none}.dsh-mj-spinner{animation:none}}
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

    function icon(name, size) {
      var Component = primitives[name];
      return typeof Component === "function"
        ? react.createElement(Component, { size: size || 16, "aria-hidden": "true" })
        : null;
    }

    function getOverlayMode() { return overlayMode; }
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
      return react.useSyncExternalStore(subscribeOverlayMode, getOverlayMode, getOverlayMode);
    }
    function getFocusResizePreference(sessionId) {
      return sessionId && focusResizePreferences.get(sessionId) || DEFAULT_FOCUS_RESIZE_PREFERENCE;
    }
    function subscribeFocusResizePreference(listener) {
      focusResizeListeners.add(listener);
      return () => focusResizeListeners.delete(listener);
    }
    function setFocusResizePreference(sessionId, nextPreference) {
      if (!sessionId || !nextPreference || !Number.isFinite(nextPreference.scale)) return;
      var nextScale = Math.max(0, Math.min(1, nextPreference.scale));
      var nextAlign = nextPreference.align === "left" || nextPreference.align === "right"
        ? nextPreference.align
        : "center";
      var defaultPosition = nextAlign === "left" ? 0 : (nextAlign === "right" ? 1 : 0.5);
      var nextPosition = Number.isFinite(nextPreference.position)
        ? Math.max(0, Math.min(1, nextPreference.position))
        : defaultPosition;
      var current = getFocusResizePreference(sessionId);
      if (current.scale === nextScale && current.align === nextAlign && current.position === nextPosition) return;
      focusResizePreferences.set(sessionId, { scale: nextScale, align: nextAlign, position: nextPosition });
      focusResizeListeners.forEach((listener) => listener());
    }
    function useFocusResizePreference(sessionId) {
      return react.useSyncExternalStore(
        subscribeFocusResizePreference,
        () => getFocusResizePreference(sessionId),
        () => getFocusResizePreference(sessionId),
      );
    }

    function isPlainObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function readStoredClientState() {
      try {
        var raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { sessionIds: [], lastSessionId: null };
        var parsed = JSON.parse(raw);
        if (!isPlainObject(parsed) || parsed.schema !== STORAGE_SCHEMA) {
          return { sessionIds: [], lastSessionId: null };
        }
        var ids = Array.isArray(parsed.sessionIds)
          ? parsed.sessionIds.filter((value) => typeof value === "string" && value.length > 0)
          : [];
        return {
          sessionIds: Array.from(new Set(ids)).slice(-20),
          lastSessionId: typeof parsed.lastSessionId === "string" ? parsed.lastSessionId : null,
        };
      } catch (_error) {
        return { sessionIds: [], lastSessionId: null };
      }
    }

    function writeStoredClientState(sessionIds, lastSessionId) {
      try {
        if (!window.localStorage) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          schema: STORAGE_SCHEMA,
          sessionIds: Array.from(sessionIds).slice(-20),
          lastSessionId: lastSessionId || null,
        }));
      } catch (_error) {
        // Server state remains authoritative when browser storage is unavailable.
      }
    }

    function responseError(payload, fallback) {
      var error = payload && payload.error;
      return error && typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : fallback;
    }

    async function requestJson(path, options) {
      var supplied = options || {};
      var headers = Object.assign({ Accept: "application/json" }, supplied.headers || {});
      if (API_REQUEST_TOKEN) headers["X-DSH-Mahjong-Request-Token"] = API_REQUEST_TOKEN;
      var init = Object.assign({ credentials: "same-origin" }, supplied, { headers });
      if (init.body !== undefined) {
        init.headers = Object.assign({}, headers, {
          "Content-Type": "application/json",
          "X-DSH-Mahjong-Client": "web",
        });
      }
      var response = await fetch(API_BASE + path, init);
      var payload;
      try { payload = await response.json(); }
      catch (_error) { throw new Error("麻将插件服务返回了无法识别的内容"); }
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(responseError(payload, "麻将插件服务暂时不可用"));
      }
      return payload;
    }

    function normalizeCatalog(payload) {
      var source = isPlainObject(payload && payload.catalog) ? payload.catalog : {};
      var providers = Array.isArray(source.providers) ? source.providers : [];
      return {
        providers: providers.flatMap((provider) => {
          if (!isPlainObject(provider) || typeof provider.id !== "string") return [];
          var models = Array.isArray(provider.models) ? provider.models : [];
          return [{
            id: provider.id,
            name: typeof provider.name === "string" && provider.name.trim() ? provider.name.trim() : provider.id,
            credentialReady: provider.credentialReady !== false,
            models: models.flatMap((model) => {
              if (!isPlainObject(model) || typeof model.id !== "string") return [];
              return [{
                id: model.id,
                name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id,
              }];
            }),
          }];
        }),
        failures: Array.isArray(source.failures) ? source.failures : [],
      };
    }

    function normalizeGameState(payload, sessionId) {
      var value = payload && payload.state;
      if (!isPlainObject(value)) {
        return { phase: "setup", sessionId: sessionId || null, locked: false, game: null };
      }
      return {
        phase: ["setup", "starting", "active", "error", "stopped"].includes(value.phase) ? value.phase : "error",
        sessionId: typeof value.sessionId === "string" ? value.sessionId : (sessionId || null),
        locked: value.locked === true,
        retryable: value.retryable === true,
        lastErrorCode: typeof value.lastErrorCode === "string" ? value.lastErrorCode : null,
        game: isPlainObject(value.game) ? value.game : null,
      };
    }

    function isMappedGameState(state) {
      return Boolean(state && (state.game || state.locked || state.phase === "starting" || state.phase === "active"));
    }

    function createMahjongController(ctx) {
      var stored = readStoredClientState();
      var knownSessionIds = new Set(stored.sessionIds);
      var listeners = new Set();
      var stateRequests = new Map();
      var caseSessions = new Map();
      var historySessions = new Map();
      var sourceSessions = new Map(), sourceRequests = new Map();
      var catalogRequest = null;
      var connection = typeof ctx.get === "function" ? ctx.get("connection") : ctx.connection;
      var snapshot = {
        panelOpen: false,
        libraryOpen:false,library:[],libraryStatus:"idle",practiceSource:null,shareResult:null,lessonsOpen:false,lessons:[],coachStatuses:{},
        catalogStatus: "idle",
        catalog: { providers: [], failures: [] },
        catalogError: null,
        formStatus: "idle",
        formError: null,
        inviteSessionId: null,
        pendingSessionId: null,
        statesBySession: {},
        lastSessionId: stored.lastSessionId,
      };

      function publish(patch) {
        snapshot = Object.assign({}, snapshot, patch);
        listeners.forEach((listener) => listener());
      }
      function publishSession(sessionId, state) {
        var patch = { statesBySession: Object.assign({}, snapshot.statesBySession, { [sessionId]: state }) };
        if (isMappedGameState(state)) {
          knownSessionIds.add(sessionId);
          patch.lastSessionId = sessionId;
          writeStoredClientState(knownSessionIds, sessionId);
        }
        publish(patch);
      }
      function rememberSession(sessionId) {
        knownSessionIds.add(sessionId);
        writeStoredClientState(knownSessionIds, sessionId);
        publish({ lastSessionId: sessionId, pendingSessionId: sessionId });
      }

      async function loadCatalog(force) {
        if (!force && snapshot.catalogStatus === "ready") return snapshot.catalog;
        if (catalogRequest) return catalogRequest;
        publish({ catalogStatus: "loading", catalogError: null });
        catalogRequest = requestJson("/models")
          .then((payload) => {
            var catalog = normalizeCatalog(payload);
            publish({ catalogStatus: "ready", catalog, catalogError: null });
            return catalog;
          })
          .catch((error) => {
            publish({
              catalogStatus: "error",
              catalogError: error instanceof Error ? error.message : "模型目录加载失败",
            });
            throw error;
          })
          .finally(() => { catalogRequest = null; });
        return catalogRequest;
      }

      async function loadSession(sessionId, force) {
        if (!sessionId) return null;
        if (!force && Object.hasOwn(snapshot.statesBySession, sessionId)) {
          return snapshot.statesBySession[sessionId];
        }
        if (stateRequests.has(sessionId)) return stateRequests.get(sessionId);
        var task = requestJson("/state?sessionId=" + encodeURIComponent(sessionId))
          .then((payload) => {
            var state = normalizeGameState(payload, sessionId);
            publishSession(sessionId, state);
            return state;
          })
          .catch((error) => {
            if (knownSessionIds.has(sessionId)) {
              publish({ formError: error instanceof Error ? error.message : "牌局状态读取失败" });
            }
            return null;
          })
          .finally(() => stateRequests.delete(sessionId));
        stateRequests.set(sessionId, task);
        return task;
      }

      function waitForListedSession(sessionId) {
        var source = ctx.sessions && ctx.sessions.list;
        if (!source || typeof source.getSnapshot !== "function") {
          return Promise.reject(new Error("Harness 会话列表尚未就绪"));
        }
        if (source.getSnapshot().byId[sessionId]) return Promise.resolve();
        return new Promise((resolve, reject) => {
          var settled = false;
          var unsubscribe = () => {};
          var timer = setTimeout(() => finish(new Error("牌局会话创建超时")), 5000);
          function finish(error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            if (error) reject(error); else resolve();
          }
          unsubscribe = source.subscribe(() => {
            if (source.getSnapshot().byId[sessionId]) finish();
          });
        });
      }

      async function createVisibleSession(title, workspaceId) {
        var api = connection && connection.api;
        if (!api || !api.sessions) throw new Error("Harness 会话服务尚未就绪");
        if(!workspaceId && typeof CLIENT_BOOT?.workspacePath === "string" && typeof ctx.workspaces?.create === "function") {
          var workspace=await ctx.workspaces.create({path:CLIENT_BOOT.workspacePath});workspaceId=workspace.workspaceId;
        }
        var sessionId;
        if (typeof ctx.sessions?.create === "function") {
          sessionId = await ctx.sessions.create(workspaceId ? {workspaceId} : {});
          rememberSession(sessionId);
        } else if (workspaceId && typeof ctx.workspaces?.connectWorkspace === "function") {
          sessionId = await ctx.workspaces.connectWorkspace(workspaceId);
          rememberSession(sessionId);
          await waitForListedSession(sessionId);
        } else {
          var created = await api.sessions.create(workspaceId ? { workspaceId } : {});
          if (!created || !created.result || created.result.ok !== true) {
            throw new Error(responseError(created && created.result, "无法创建牌局问答会话"));
          }
          sessionId = created.result.value.sessionId;
          rememberSession(sessionId);
          await waitForListedSession(sessionId);
        }
        var renamed = await api.sessions.rename({ sessionId, title: "麻将实验室 · " + title });
        if (!renamed || !renamed.result || renamed.result.ok !== true) {
          throw new Error(responseError(renamed && renamed.result, "牌局会话命名失败"));
        }
        return sessionId;
      }

      async function startGame(draft, workspaceId) {
        publish({ formStatus: "starting", formError: null });
        try {
          var pendingId = snapshot.pendingSessionId;
          var listed = pendingId && ctx.sessions.list.getSnapshot().byId[pendingId];
          var sessionId = listed
            ? pendingId
            : await createVisibleSession(draft.tableName, workspaceId);
          var payload = await requestJson(snapshot.practiceSource ? "/practice/start" : "/games/start", {
            method: "POST",
            body: JSON.stringify(Object.assign({ sessionId }, draft, snapshot.practiceSource ? {sourceSessionId:snapshot.practiceSource.sessionId} : {})),
          });
          var state = normalizeGameState(payload, sessionId);
          publishSession(sessionId, state);
          if (state.phase !== "active" || !state.game) throw new Error("牌局尚未进入可用状态");
          ctx.sessions.open(sessionId);
          setOverlayMode("large");
          publish({ panelOpen: false, formStatus: "idle", formError: null, pendingSessionId: null,practiceSource:null });
          return state;
        } catch (error) {
          publish({
            formStatus: "error",
            formError: error instanceof Error ? error.message : "开桌失败，请稍后重试",
          });
          throw error;
        }
      }

      async function openSources(){
        publish({sourcesOpen:true,panelOpen:false,libraryOpen:false,formError:null});
        try{var result=await requestJson("/sources");publish({sources:result.items});}catch(error){publish({formError:error.message});}
      }
      async function openSource(caseId,eventIndex=0,seat=0,workspaceId,lesson=null,viewMode="fixed"){
        if(snapshot.formStatus==="starting")return;publish({formStatus:"starting",formError:null});
        try{
          var key=caseId+":"+eventIndex+":"+seat+":"+lesson+":"+viewMode,known=sourceSessions.get(key);
          var sessionId=known&&ctx.sessions.list.getSnapshot().byId[known]?known:await createVisibleSession("赛事回放 · "+(eventIndex+1)+"步",workspaceId);
          var result=await requestJson("/sources/open",{method:"POST",body:JSON.stringify({sessionId,caseId,eventIndex,seat,lesson,viewMode})});
          var state=normalizeGameState(result,sessionId);publishSession(sessionId,state);sourceSessions.set(key,sessionId);
          await connection.api.sessions.rename({sessionId,title:"麻将实验室 · "+state.game.tableName});
          ctx.sessions.open(sessionId);setOverlayMode("large");
          publish({sourcesOpen:false,libraryOpen:false,panelOpen:false,formStatus:"idle",pendingSessionId:null});return state;
        }catch(error){publish({formStatus:"error",formError:error.message});}
      }
      async function stepSource(sessionId,eventIndex,seat,lesson=null,viewMode){
        var pending=sourceRequests.get(sessionId),request={sessionId,eventIndex,seat,lesson,viewMode};
        if(pending){pending.next=request;return pending.promise;}
        var work={next:request};sourceRequests.set(sessionId,work);publish({sourceLoading:true,formError:null});
        work.promise=(async()=>{try{
          while(work.next){var next=work.next;work.next=null;var result=await requestJson("/sources/step",{method:"POST",body:JSON.stringify(next)});publishSession(sessionId,normalizeGameState(result,sessionId));}
        }catch(error){publish({formError:error.message});}finally{sourceRequests.delete(sessionId);publish({sourceLoading:sourceRequests.size>0});}})();
        return work.promise;
      }
      async function askSource(sessionId){
        var game=snapshot.statesBySession[sessionId]?.game,source=game?.sourceReplay;if(!source||snapshot.sourceLoading||correctionPanelOpen)return;
        if(source.questionHash!==source.sourceHash)sourceSessions.clear();
        if(source.questionHash!==source.sourceHash||source.questionIndex!==game.historyIndex||source.questionSeat!==source.seat||source.questionLesson!==source.lesson){
          var state=await openSource(source.caseId,game.historyIndex,source.fixedSeat??source.seat,undefined,source.lesson,source.viewMode);if(!state)return;
        }
        setOverlayMode("compact");focusNativeComposer();
      }
      async function openCase(eventIndex, workspaceId) {
        if (snapshot.formStatus === "starting") return;
        publish({ formStatus: "starting", formError: null });
        try {
          var labels = ["摸牌前", "摸入三条", "自摸后记分"];
          var known = caseSessions.get(eventIndex);
          var sessionId = known && ctx.sessions.list.getSnapshot().byId[known]
            ? known : await createVisibleSession("赛事复盘 · " + labels[eventIndex], workspaceId);
          var payload = await requestJson("/cases/open", {
            method: "POST", body: JSON.stringify({ sessionId, eventIndex }),
          });
          var state = normalizeGameState(payload, sessionId);
          publishSession(sessionId, state);
          caseSessions.set(eventIndex, sessionId);
          ctx.sessions.open(sessionId);
          setOverlayMode("large");
          publish({ panelOpen: false, formStatus: "idle", pendingSessionId: null });
        } catch (error) {
          publish({ formStatus: "error", formError: error instanceof Error ? error.message : "案例加载失败" });
        }
      }

      async function openLessons(){
        publish({lessonsOpen:true,formError:null});
        try{var result=await requestJson("/coach/lessons");publish({lessons:result.lessons});}catch(error){publish({formError:error.message});}
      }
      async function startLesson(lessonId,workspaceId){
        if(snapshot.formStatus==="starting")return;publish({formStatus:"starting",formError:null});
        try{
          var title=snapshot.lessons.find(lesson=>lesson.id===lessonId)?.title??"基础教学";
          var sessionId=await createVisibleSession(title,workspaceId);
          var result=await requestJson("/coach/start",{method:"POST",body:JSON.stringify({sessionId,lessonId})});
          publishSession(sessionId,normalizeGameState(result,sessionId));ctx.sessions.open(sessionId);setOverlayMode("large");
          publish({lessonsOpen:false,panelOpen:false,libraryOpen:false,formStatus:"idle",pendingSessionId:null});
        }catch(error){publish({formStatus:"error",formError:error.message});}
      }
      async function readCoachStatus(sessionId){
        try{var result=await requestJson("/coach/status",{method:"POST",body:JSON.stringify({sessionId})});publish({coachStatuses:Object.assign({},snapshot.coachStatuses,{[sessionId]:result})});return result;}
        catch(error){publish({formError:error.message});}
      }
      async function openLibrary() {
        publish({libraryOpen:true,libraryStatus:"loading",formError:null});
        try {var result=await requestJson("/library");publish({library:result.items,libraryStatus:"ready"});}
        catch(error){publish({libraryStatus:"error",formError:error.message});}
      }
      async function openHistory(gameId,eventIndex,workspaceId) {
        if(snapshot.formStatus==="starting")return;
        publish({formStatus:"starting",formError:null});
        try {
          var key=gameId+":"+eventIndex;
          var known=historySessions.get(key);
          var sessionId=known&&ctx.sessions.list.getSnapshot().byId[known]?known:await createVisibleSession("牌谱复盘 · "+(eventIndex===undefined?"起手":"步骤 "+eventIndex),workspaceId);
          var payload=await requestJson("/history/open",{method:"POST",body:JSON.stringify({sessionId,gameId,eventIndex})});
          var state=normalizeGameState(payload,sessionId);publishSession(sessionId,state);
          historySessions.set(gameId+":"+state.game.historyIndex,sessionId);
          ctx.sessions.open(sessionId);setOverlayMode("large");
          publish({libraryOpen:false,panelOpen:false,formStatus:"idle",pendingSessionId:null});
        }catch(error){publish({formStatus:"error",formError:error.message});}
      }
      async function replayAction(operation,input) {
        publish({formError:null});
        try{
          var result=await requestJson("/replays/"+operation,{method:"POST",body:JSON.stringify(input)});
          if(operation==="export") {
            var url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:"application/json"}));
            var link=document.createElement("a");link.href=url;link.download="mahjong-"+input.gameId+".json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
          }
          if(operation==="share"){
            publish({shareResult:{gameId:input.gameId,shareId:result.shareId,url:result.shareUrl}});
          }
          if(operation==="revokeShare")publish({shareResult:null});
          if(operation==="import")await openLibrary();
          return result;
        }catch(error){publish({formError:error.message});throw error;}
      }
      async function retryGame(sessionId) {
        if (!sessionId) return;
        publish({ formStatus: "starting", formError: null });
        try {
          var payload = await requestJson("/games/retry", {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          });
          var state = normalizeGameState(payload, sessionId);
          publishSession(sessionId, state);
          if (state.phase === "active" && state.game) {
            ctx.sessions.open(sessionId);
            publish({ panelOpen: false, formStatus: "idle", pendingSessionId: null });
          } else publish({ formStatus: "error", formError: "牌局重试尚未成功" });
        } catch (error) {
          publish({ formStatus: "error", formError: error instanceof Error ? error.message : "牌局重试失败" });
        }
      }

      async function openEntry() {
        publish({panelOpen:true,formError:null,practiceSource:null,pendingSessionId:null});
        loadCatalog(false).catch(()=>{});
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        openEntry,
        closePanel() {
          if (snapshot.formStatus !== "starting") publish({ panelOpen: false, formError: null });
        },
        openInvites(sessionId) {
          if (typeof sessionId === "string" && sessionId) publish({ inviteSessionId: sessionId });
        },
        closeInvites() { publish({ inviteSessionId: null }); },
        loadCatalog,
        loadSession,
        startGame,
        openCase,
        openSources,openSource,stepSource,askSource,
        async sourceEditorRequest(op,input){var payload=await requestJson('/source-editor/'+op,{method:'POST',body:JSON.stringify(input)});if(payload.result.state){publishSession(input.sessionId,payload.result.state);sourceSessions.clear();}return payload.result;},
        async sourceEditorVideo(sessionId){var response=await fetch(API_BASE+'/source-editor/video',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-dsh-mahjong-request-token':API_REQUEST_TOKEN},body:JSON.stringify({sessionId})});if(!response.ok){var p=await response.json();throw new Error(p.error?.message??'视频打开失败');}return response.blob();},
        closeSources(){publish({sourcesOpen:false,formError:null});},
        openLibrary,
        openLessons,
        startLesson,
        readCoachStatus,
        closeLessons(){publish({lessonsOpen:false});},
        newTable(){publish({panelOpen:true,pendingSessionId:null,practiceSource:null});loadCatalog(false).catch(()=>{});},
        closeLibrary(){publish({libraryOpen:false,formError:null});},
        openHistory,
        replayAction,
        beginPractice(sessionId){var state=snapshot.statesBySession[sessionId];if(state?.game?.canPractice){publish({practiceSource:{sessionId,frame:state.game.historyFrame},panelOpen:true,pendingSessionId:null});loadCatalog(false).catch(()=>{});}},
        retryGame,
      };
    }

    function useController(controller) {
      return react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    }

    function isTrustedHandUrl(parsed) {
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (parsed.username || parsed.password) return false;
      var localHttp = parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "localhost." || parsed.hostname === "[::1]" || /^127(?:\.[0-9]{1,3}){3}$/.test(parsed.hostname));
      var configuredHttps = parsed.protocol === "https:";
      return (localHttp || configuredHttps) && (parsed.pathname === "/hand" || parsed.pathname === "/hand/" || (parsed.origin === window.location.origin && parsed.pathname === "/dsh-mahjong/view/hand/"));
    }
    function safeHandUrl(candidate, gameId) {
      if (typeof candidate !== "string" || typeof gameId !== "string" || !gameId) return null;
      try {
        var parsed = new URL(candidate, window.location.href);
        if (!isTrustedHandUrl(parsed) || parsed.searchParams.get("gameId") !== gameId) return null;
        parsed.searchParams.set("parentOrigin", window.location.origin);
        return parsed.toString();
      } catch (_error) { return null; }
    }
    function requestHandReady(frame, frameUrl) {
      if (!frame || !frame.contentWindow || !frameUrl) return;
      var address = new URL(frameUrl);
      var gameId = address.searchParams.get("gameId");
      if (!gameId) return;
      frame.contentWindow.postMessage({ type: HAND_READY_REQUEST_MESSAGE, gameId }, address.origin);
    }

    function resizeAlignmentForEdge(edge) {
      if (edge === "left" || edge === "bottom-left") return "right";
      if (edge === "right" || edge === "bottom-right") return "left";
      return "center";
    }
    function resizeAnchorPositionForEdge(edge, stageLeft, stageWidth, scrollLeft, scrollWidth) {
      var anchorX = stageLeft + stageWidth / 2;
      if (edge === "left" || edge === "bottom-left") anchorX = stageLeft + stageWidth;
      if (edge === "right" || edge === "bottom-right") anchorX = stageLeft;
      return scrollWidth > 0
        ? Math.max(0, Math.min(1, (anchorX - scrollLeft) / scrollWidth))
        : 0.5;
    }
    function resizeMaximumWidthForAnchor(edge, anchorPosition, scrollWidth, maximumWidth) {
      var position = Number.isFinite(anchorPosition) ? Math.max(0, Math.min(1, anchorPosition)) : 0.5;
      var availableWidth;
      if (edge === "left" || edge === "bottom-left") availableWidth = scrollWidth * position;
      else if (edge === "right" || edge === "bottom-right") availableWidth = scrollWidth * (1 - position);
      else availableWidth = 2 * scrollWidth * Math.min(position, 1 - position);
      return Math.max(0, Math.min(maximumWidth, availableWidth));
    }
    function focusPreferenceForWidth(edge, width, maximumWidth, anchorPosition, resizeMaximumWidth) {
      var allowedMaximumWidth = Number.isFinite(resizeMaximumWidth)
        ? Math.max(0, Math.min(maximumWidth, resizeMaximumWidth))
        : maximumWidth;
      var minimumWidth = Math.min(allowedMaximumWidth, 480);
      var nextWidth = Math.max(minimumWidth, Math.min(allowedMaximumWidth, width));
      return {
        scale: maximumWidth > 0 ? nextWidth / maximumWidth : 1,
        align: resizeAlignmentForEdge(edge),
        position: Number.isFinite(anchorPosition) ? Math.max(0, Math.min(1, anchorPosition)) : undefined,
      };
    }
    function focusPreferenceFromPointer(edge, startWidth, maximumWidth, deltaX, deltaY, anchorPosition, resizeMaximumWidth) {
      var widthDelta;
      if (edge === "left") widthDelta = -deltaX;
      else if (edge === "right") widthDelta = deltaX;
      else if (edge === "bottom") widthDelta = deltaY * TABLE_RATIO;
      else {
        var horizontalDirection = edge === "bottom-left" ? -TABLE_RATIO : TABLE_RATIO;
        var projectedHeight = (horizontalDirection * deltaX + deltaY) /
          (TABLE_RATIO * TABLE_RATIO + 1);
        widthDelta = projectedHeight * TABLE_RATIO;
      }
      return focusPreferenceForWidth(
        edge,
        startWidth + widthDelta,
        maximumWidth,
        anchorPosition,
        resizeMaximumWidth,
      );
    }
    function calculateStageGeometry(scroller, composer, mode, focusPreference) {
      var scrollRect = scroller.getBoundingClientRect();
      var composerRect = composer ? composer.getBoundingClientRect() : null;
      var usableBottom = composerRect
        ? Math.min(scrollRect.bottom, Math.max(scrollRect.top, composerRect.top))
        : scrollRect.bottom;
      var usableHeight = Math.max(0, usableBottom - scrollRect.top);

      if (mode === "large") {
        var maximumWidth = Math.min(scrollRect.width, usableHeight * TABLE_RATIO);
        if (maximumWidth < 1) return null;
        var minimumWidth = Math.min(maximumWidth, 480);
        var requestedScale = focusPreference && Number.isFinite(focusPreference.scale)
          ? focusPreference.scale
          : 1;
        var scale = Math.max(minimumWidth / maximumWidth, Math.min(1, requestedScale));
        var largeWidth = maximumWidth * scale;
        var largeHeight = largeWidth / TABLE_RATIO;
        var align = focusPreference && (focusPreference.align === "left" || focusPreference.align === "right")
          ? focusPreference.align
          : "center";
        var defaultPosition = align === "left" ? 0 : (align === "right" ? 1 : 0.5);
        var position = focusPreference && Number.isFinite(focusPreference.position)
          ? Math.max(0, Math.min(1, focusPreference.position))
          : defaultPosition;
        var anchorX = scrollRect.left + scrollRect.width * position;
        var largeLeft = anchorX - largeWidth / 2;
        if (align === "left") largeLeft = anchorX;
        if (align === "right") largeLeft = anchorX - largeWidth;
        largeLeft = Math.max(scrollRect.left, Math.min(scrollRect.right - largeWidth, largeLeft));
        return {
          left: largeLeft,
          top: scrollRect.top,
          width: largeWidth,
          height: largeHeight,
        };
      }

      var targetHeight = usableHeight * 0.5;
      var height = Math.min(targetHeight, scrollRect.width / TABLE_RATIO);
      if (height < 1) return null;
      var width = height * TABLE_RATIO;
      return {
        left: scrollRect.left + (scrollRect.width - width) / 2,
        top: scrollRect.top,
        width,
        height,
      };
    }
    function applyStageGeometry(stage, geometry) {
      if (!geometry) { stage.removeAttribute("data-layout-ready"); return; }
      stage.style.left = geometry.left + "px";
      stage.style.top = geometry.top + "px";
      stage.style.width = geometry.width + "px";
      stage.style.height = geometry.height + "px";
      stage.setAttribute("data-layout-ready", "true");
    }

    function MahjongTable(props) {
      var currentSessionId = props.useSessions((state) => state.current);
      var client = useController(props.controller);
      var sessionState = currentSessionId ? client.statesBySession[currentSessionId] : null;
      var game = sessionState && sessionState.phase === "active" ? sessionState.game : null;
      var active = Boolean(currentSessionId && game);
      var mode = useOverlayMode();
      var focusPreference = useFocusResizePreference(currentSessionId);
      var statusPair = react.useState("loading");
      var frameStatus = statusPair[0];
      var setFrameStatus = statusPair[1];
      var rootRef = react.useRef(null);
      var stageRef = react.useRef(null);
      var frameRef = react.useRef(null);
      var dragPreferenceRef = react.useRef(focusPreference);
      var resizeSessionRef = react.useRef(null);
      if (!resizeSessionRef.current) dragPreferenceRef.current = focusPreference;
      var frameUrl = react.useMemo(
        () => game ? safeHandUrl(game.handUrl, game.gameId) : null,
        [game && game.handUrl, game && game.gameId],
      );

      react.useEffect(() => {
        if (currentSessionId) props.controller.loadSession(currentSessionId, false);
      }, [currentSessionId]);
      react.useEffect(() => {
        setFrameStatus(frameUrl ? "loading" : (game ? "error" : "loading"));
      }, [frameUrl, game && game.gameId]);
      react.useEffect(() => {
        if (!frameUrl) return () => {};
        var address = new URL(frameUrl);
        var expectedOrigin = address.origin;
        var expectedGameId = address.searchParams.get("gameId");
        function onFrameMessage(event) {
          var frame = frameRef.current;
          if (!frame || event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
          var data = event.data;
          if (data && data.type === "dsh-mahjong:case-request" && game && game.mode === "case" &&
              data.gameId === expectedGameId && data.eventIndex === game.caseFrame.eventIndex) {
            frame.contentWindow.postMessage({ type: "dsh-mahjong:case-frame", frame: game.caseFrame }, expectedOrigin);
            return;
          }
          if(data?.type === "dsh-mahjong:navigate" && data.gameId === expectedGameId) {
            if(data.action === "home" || data.action === "new")props.controller.newTable();
            else if(data.action === "practice" && game?.canPractice)props.controller.beginPractice(currentSessionId);
            else if(data.action === "replay")props.controller.openHistory(expectedGameId);
            else if(["share","practice"].includes(data.action))props.controller.openLibrary();
            return;
          }
          if(data && ["replay","source-replay"].includes(game?.mode) && data.gameId === expectedGameId) {
            if(data.type === "dsh-mahjong:history-request") {frame.contentWindow.postMessage({type:"dsh-mahjong:history-frame",frame:correctionPreviewActive?correctionPreview.frame:game.historyFrame,count:correctionPreviewActive?correctionPreview.count:game.historyCount,first:game.historyFirst},expectedOrigin);return;}
            if(data.type === "dsh-mahjong:history-step" && correctionPanelOpen)return;
            if(data.type === "dsh-mahjong:history-step" && Number.isInteger(data.eventIndex)) {if(game.mode==="source-replay")props.controller.stepSource(currentSessionId,data.eventIndex,game.sourceReplay.seat);else props.controller.openHistory(expectedGameId,data.eventIndex);return;}
          }
          if (!data || data.type !== HAND_READY_MESSAGE || data.gameId !== expectedGameId) return;
          setFrameStatus("live");
        }
        window.addEventListener("message", onFrameMessage);
        requestHandReady(frameRef.current, frameUrl);
        if(!correctionPreviewActive && game?.historyFrame && frameRef.current?.contentWindow)frameRef.current.contentWindow.postMessage({type:"dsh-mahjong:history-frame",frame:game.historyFrame,count:game.historyCount,first:game.historyFirst},expectedOrigin);
        return () => window.removeEventListener("message", onFrameMessage);
      }, [frameUrl, game && game.caseFrame, game && game.historyFrame]);

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
          if (!active || !scroller) { stage.removeAttribute("data-layout-ready"); return; }
          applyStageGeometry(stage, editorLayout(scroller, composer, mode, dragPreferenceRef.current));
        }
        function scheduleSync() {
          if (scheduledFrame === null) scheduledFrame = requestAnimationFrame(sync);
        }
        function sampleTransition() {
          transitionFrame = null;
          sync();
          if (performance.now() < sampleUntil) transitionFrame = requestAnimationFrame(sampleTransition);
        }
        function startTransitionSampling() {
          sampleUntil = performance.now() + 420;
          if (transitionFrame === null) transitionFrame = requestAnimationFrame(sampleTransition);
        }
        function onGridTransitionRun(event) {
          if (event.target === appFrame && event.propertyName === "grid-template-columns") startTransitionSampling();
        }
        function onGridTransitionEnd(event) {
          if (event.target === appFrame && event.propertyName === "grid-template-columns") scheduleSync();
        }
        function onComposerPointerDown(event) {
          var target = event.target;
          if (target instanceof Element && target.closest("[data-composer-seat]")) setOverlayMode("compact");
        }
        window.addEventListener("dsh-correction-layout",scheduleSync);
        resizeObserver.observe(appFrame);
        var initialScroller = appFrame.querySelector("[data-conversation-scroll]");
        if (initialScroller) contentMutationObserver.observe(initialScroller.parentElement || initialScroller, { childList: true, subtree: true });
        frameMutationObserver.observe(appFrame, {
          attributes: true,
          attributeFilter: ["style", "data-sidebar-collapsed", "data-details-collapsed", "data-dragging"],
        });
        appFrame.addEventListener("transitionrun", onGridTransitionRun);
        appFrame.addEventListener("transitionend", onGridTransitionEnd);
        appFrame.addEventListener("pointerdown", onComposerPointerDown, true);
        sync();
        return () => {
          window.removeEventListener("dsh-correction-layout",scheduleSync);
          resizeObserver.disconnect();
          frameMutationObserver.disconnect();
          contentMutationObserver.disconnect();
          appFrame.removeEventListener("transitionrun", onGridTransitionRun);
          appFrame.removeEventListener("transitionend", onGridTransitionEnd);
          appFrame.removeEventListener("pointerdown", onComposerPointerDown, true);
          if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
          if (transitionFrame !== null) cancelAnimationFrame(transitionFrame);
        };
      }, [active, mode, currentSessionId]);

      react.useEffect(() => () => {
        if (resizeSessionRef.current) resizeSessionRef.current(false);
      }, []);

      function resizeTargets() {
        if(correctionPanelOpen)return null;
        var root = rootRef.current;
        var stage = stageRef.current;
        var shellOverlay = root && root.closest("[data-shell-overlay]");
        var appFrame = shellOverlay && shellOverlay.parentElement;
        var scroller = appFrame && appFrame.querySelector("[data-conversation-scroll]");
        var composer = appFrame && appFrame.querySelector("[data-composer-seat]");
        if (!stage || !scroller) return null;
        var maximum = calculateStageGeometry(scroller, composer, "large", { scale: 1, align: "center" });
        return maximum ? { stage, scroller, composer, maximum } : null;
      }
      function applyResizePreference(targets, preference) {
        dragPreferenceRef.current = preference;
        applyStageGeometry(
          targets.stage,
          calculateStageGeometry(targets.scroller, targets.composer, "large", preference),
        );
      }
      function beginStageResize(edge, event) {
        if (mode !== "large" || (typeof event.button === "number" && event.button !== 0)) return;
        var targets = resizeTargets();
        if (!targets) return;
        if (resizeSessionRef.current) resizeSessionRef.current(false);
        event.preventDefault();
        event.stopPropagation();
        var handle = event.currentTarget;
        var pointerId = event.pointerId;
        var startX = event.clientX;
        var startY = event.clientY;
        var startRect = targets.stage.getBoundingClientRect();
        var scrollRect = targets.scroller.getBoundingClientRect();
        var startWidth = startRect.width;
        var anchorPosition = resizeAnchorPositionForEdge(
          edge,
          startRect.left,
          startRect.width,
          scrollRect.left,
          scrollRect.width,
        );
        var resizeMaximumWidth = resizeMaximumWidthForAnchor(
          edge,
          anchorPosition,
          scrollRect.width,
          targets.maximum.width,
        );
        var startPreference = dragPreferenceRef.current;
        var pendingPoint = null;
        var resizeFrame = null;
        var finished = false;
        targets.stage.setAttribute("data-resizing", "true");
        try { handle.setPointerCapture(pointerId); } catch (_error) {}
        function applyPendingPoint() {
          resizeFrame = null;
          if (!pendingPoint) return;
          var point = pendingPoint;
          pendingPoint = null;
          applyResizePreference(targets, focusPreferenceFromPointer(
            edge,
            startWidth,
            targets.maximum.width,
            point.x - startX,
            point.y - startY,
            anchorPosition,
            resizeMaximumWidth,
          ));
        }
        function schedulePointer(point) {
          pendingPoint = point;
          if (resizeFrame === null) resizeFrame = requestAnimationFrame(applyPendingPoint);
        }
        function removeResizeListeners() {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerCancel);
          window.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("keydown", onWindowKeyDown);
          window.removeEventListener("blur", onWindowBlur);
          handle.removeEventListener("pointerup", onPointerUp);
          handle.removeEventListener("pointercancel", onPointerCancel);
          handle.removeEventListener("lostpointercapture", onLostPointerCapture);
        }
        function finish(commit) {
          if (finished) return;
          finished = true;
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          removeResizeListeners();
          targets.stage.removeAttribute("data-resizing");
          try {
            if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          } catch (_error) {}
          resizeSessionRef.current = null;
          if (commit) setFocusResizePreference(currentSessionId, dragPreferenceRef.current);
          else {
            dragPreferenceRef.current = startPreference;
            applyStageGeometry(
              targets.stage,
              calculateStageGeometry(targets.scroller, targets.composer, "large", startPreference),
            );
          }
        }
        function onPointerMove(moveEvent) {
          if (moveEvent.pointerId !== pointerId) return;
          moveEvent.preventDefault();
          schedulePointer({ x: moveEvent.clientX, y: moveEvent.clientY });
        }
        function commitAt(x, y) {
          if (finished) return;
          pendingPoint = { x, y };
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          applyPendingPoint();
          finish(true);
        }
        function onPointerUp(upEvent) {
          if (upEvent.pointerId === pointerId) commitAt(upEvent.clientX, upEvent.clientY);
        }
        function onPointerCancel(cancelEvent) {
          if (cancelEvent.pointerId === pointerId) finish(false);
        }
        function onMouseUp(mouseEvent) { commitAt(mouseEvent.clientX, mouseEvent.clientY); }
        function onLostPointerCapture() { finish(false); }
        function onWindowKeyDown(keyEvent) {
          if (keyEvent.key === "Escape") { keyEvent.preventDefault(); finish(false); }
        }
        function onWindowBlur() { finish(false); }
        resizeSessionRef.current = finish;
        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("keydown", onWindowKeyDown);
        window.addEventListener("blur", onWindowBlur);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerCancel);
        handle.addEventListener("lostpointercapture", onLostPointerCapture);
      }
      function resizeStageWithKeyboard(edge, event) {
        var supported = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
        if (mode !== "large" || !supported.includes(event.key)) return;
        var targets = resizeTargets();
        if (!targets) return;
        event.preventDefault();
        var currentRect = targets.stage.getBoundingClientRect();
        var scrollRect = targets.scroller.getBoundingClientRect();
        var currentWidth = currentRect.width;
        var nextWidth;
        if (event.key === "Home") nextWidth = 0;
        else if (event.key === "End") nextWidth = targets.maximum.width;
        else {
          var grow = event.key === "ArrowRight" || event.key === "ArrowDown";
          nextWidth = currentWidth + (grow ? 1 : -1) * (event.shiftKey ? 48 : 16);
        }
        var anchorPosition = resizeAnchorPositionForEdge(
          edge,
          currentRect.left,
          currentRect.width,
          scrollRect.left,
          scrollRect.width,
        );
        var resizeMaximumWidth = resizeMaximumWidthForAnchor(
          edge,
          anchorPosition,
          scrollRect.width,
          targets.maximum.width,
        );
        var nextPreference = focusPreferenceForWidth(
          edge,
          nextWidth,
          targets.maximum.width,
          anchorPosition,
          resizeMaximumWidth,
        );
        applyResizePreference(targets, nextPreference);
        setFocusResizePreference(currentSessionId, nextPreference);
      }
      function resizeHandle(edge, label) {
        return react.createElement("button", {
          key: edge,
          type: "button",
          className: "dsh-mj-resize-handle dsh-mj-resize-" + edge,
          "data-dsh-mahjong-resize-edge": edge,
          "aria-label": label,
          "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Home End",
          title: label + "（方向键微调，Shift 加速）",
          onPointerDown: (resizeEvent) => beginStageResize(edge, resizeEvent),
          onKeyDown: (keyEvent) => resizeStageWithKeyboard(edge, keyEvent),
        });
      }

      return react.createElement(
        "div",
        { ref: rootRef, "data-dsh-mahjong-table-root": "true" },
        react.createElement(
          "section",
          {
            ref: stageRef,
            className: "dsh-mj-stage",
            "data-dsh-mahjong-stage": "true",
            "data-frame-status": frameStatus,
            "aria-label": "MJLab 牌桌",
            "aria-busy": active && frameStatus !== "live" && frameStatus !== "error",
          },
          frameUrl
            ? react.createElement("iframe", {
              ref: frameRef,
              className: "dsh-mj-frame",
              "data-dsh-mahjong-frame": "true",
              src: frameUrl,
              title: "MJLab /hand/ 牌局",
              allow: "fullscreen; autoplay",
              referrerPolicy: "no-referrer",
              onError: () => setFrameStatus("error"),
              onLoad: () => requestHandReady(frameRef.current, frameUrl),
            })
            : (active ? react.createElement("div", { className: "dsh-mj-frame-error", role: "alert" }, "牌桌地址未通过安全检查") : null),
          game && game.mode === "case" ? react.createElement("div", {
            "data-dsh-case-caption": "true",
            style: { position: "absolute", top: 8, left: 8, right: 8, color: "#fff", background: "rgba(10,20,30,.88)", padding: "8px 12px", fontSize: 12, lineHeight: "18px", pointerEvents: "none" },
          }, game.caseFrame.title + " · 局部案例复盘（非完整牌谱）",
            react.createElement("br"), "LC 手牌教学视角；其他三家、牌河、牌墙未还原；头像为占位；LC 分数＝本副前黄色分数＋已知变化") : null,
          mode === "large" ? [
            resizeHandle("left", "调整牌桌左边界，右边固定"),
            resizeHandle("right", "调整牌桌右边界，左边固定"),
            resizeHandle("bottom", "调整牌桌下边界，水平居中"),
            resizeHandle("bottom-left", "调整牌桌左下角，右上角固定"),
            resizeHandle("bottom-right", "调整牌桌右下角，左上角固定"),
          ] : null,
        ),
      );
    }

    function flattenedModels(catalog) {
      return catalog.providers.flatMap((provider) => provider.credentialReady === false
        ? []
        : provider.models.map((model) => ({
        provider: provider.id,
        providerName: provider.name,
        model: model.id,
        modelLabel: model.name,
      })));
    }
    function initialDraft() {
      return {
        tableName: "我的麻将牌局",
        ruleset: "blood",
        autoBuhua: true,
        timeoutSeconds: "38",
        seats: [
          { seat: 0, kind: "human", initialPoints: "4800", provider: "", model: "", modelLabel: "" },
          { seat: 1, kind: "ai", initialPoints: "4800", provider: "", model: "", modelLabel: "" },
          { seat: 2, kind: "ai", initialPoints: "4800", provider: "", model: "", modelLabel: "" },
          { seat: 3, kind: "ai", initialPoints: "4800", provider: "", model: "", modelLabel: "" },
        ],
      };
    }
    function assignDefaultModels(draft, catalog) {
      var models = flattenedModels(catalog);
      if (models.length === 0) return draft;
      var changed = false;
      var seats = draft.seats.map((seat, index) => {
        if (seat.kind !== "ai" || (seat.provider && seat.model)) return seat;
        changed = true;
        return Object.assign({}, seat, models[index % models.length]);
      });
      return changed ? Object.assign({}, draft, { seats }) : draft;
    }
    function selectedModelValue(seat) { return JSON.stringify([seat.provider, seat.model]); }
    function updateSeatModel(seat, value, catalog) {
      try {
        var tuple = JSON.parse(value);
        if (!Array.isArray(tuple) || tuple.length !== 2) return seat;
        var provider = catalog.providers.find((item) => item.id === tuple[0] && item.credentialReady !== false);
        var model = provider && provider.models.find((item) => item.id === tuple[1]);
        return provider && model
          ? Object.assign({}, seat, { provider: provider.id, model: model.id, modelLabel: model.name })
          : seat;
      } catch (_error) { return seat; }
    }
    function serializeDraft(draft) {
      var tableName = draft.tableName.trim();
      if (!tableName) throw new Error("请输入桌名");
      if (tableName.length > 40) throw new Error("桌名最多 40 个字符");
      var timeoutSeconds = Number(draft.timeoutSeconds);
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 120) {
        throw new Error("出牌超时需为 10 到 120 秒的整数");
      }
      var ownerAssigned = false;
      var seats = draft.seats.map((seat) => {
        var initialPoints = Number(seat.initialPoints);
        if (String(seat.initialPoints).trim() === "" || !Number.isSafeInteger(initialPoints) || initialPoints < 0 || initialPoints > 1000000) {
          throw new Error(["东", "南", "西", "北"][seat.seat] + "家初始积分需为 0 到 1,000,000 的整数");
        }
        if (seat.kind === "human") {
          var owner = !ownerAssigned;
          ownerAssigned = true;
          return { seat: seat.seat, kind: "human", owner, initialPoints };
        }
        if (!seat.provider || !seat.model) throw new Error("每个 AI 座位都需要选择模型");
        return {
          seat: seat.seat,
          kind: "ai",
          initialPoints,
          provider: seat.provider,
          model: seat.model,
          modelLabel: seat.modelLabel || seat.model,
        };
      });
      return { tableName, timeoutSeconds, seats, ruleset: draft.ruleset || "blood", ruleOptions: draft.ruleset === "guobiao" ? {autoBuhua: draft.autoBuhua !== false} : {} };
    }
    function resolveWorkspaceId(workspaces, currentSessionId) {
      var items = workspaces && Array.isArray(workspaces.items) ? workspaces.items : [];
      var current = items.find((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(currentSessionId));
      if (current) return current.workspaceId;
      var recent = workspaces && workspaces.recentWorkspaceId;
      return items.some((workspace) => workspace.workspaceId === recent) ? recent : undefined;
    }
    function trapDialogFocus(event, dialog) {
      if (event.key !== "Tab" || !dialog) return;
      var focusable = Array.from(dialog.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex=\"-1\"])") || []);
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }

    function SeatCard(props) {
      var seat = props.seat;
      var humanLabel = props.humanOrder === 0 ? "真人（我）" : "真人（待加入）";
      var modelLabel = seat.modelLabel || "未选择模型";
      return react.createElement(
        "article",
        { className: "dsh-mj-seat", "data-seat": String(seat.seat) },
        react.createElement(
          "div",
          { className: "dsh-mj-seat-header" },
          react.createElement("div", { className: "dsh-mj-seat-name" },
            seat.kind === "ai" ? icon("IconSparkle16", 15) : icon("IconUserOutline16", 15),
            react.createElement("span", null, ["东", "南", "西", "北"][seat.seat] + "家")),
          react.createElement(
            "div",
            { className: "dsh-mj-kind-group", role: "group", "aria-label": "座位类型" },
            react.createElement("button", { type: "button", className: "dsh-mj-kind-button", "aria-pressed": seat.kind === "human", disabled: props.disabled, onClick: () => props.onKind("human") }, "真人"),
            react.createElement("button", { type: "button", className: "dsh-mj-kind-button", "aria-pressed": seat.kind === "ai", disabled: props.disabled, onClick: () => props.onKind("ai") }, "AI"),
          ),
        ),
        seat.kind === "ai"
          ? react.createElement(
            "div",
            { className: "dsh-mj-model-row" },
            react.createElement(
              "select",
              { className: "dsh-mj-select", value: selectedModelValue(seat), disabled: props.disabled || props.models.length === 0, "aria-label": ["东", "南", "西", "北"][seat.seat] + "家 AI 模型", onChange: (event) => props.onModel(event.target.value) },
              props.models.length === 0 ? react.createElement("option", { value: '["",""]' }, "暂无可用模型") : null,
              props.catalog.providers.map((provider) => react.createElement(
                "optgroup",
                { key: provider.id, label: provider.name + (provider.credentialReady === false ? "（未配置）" : ""), disabled: provider.credentialReady === false },
                provider.models.map((model) => react.createElement("option", { key: provider.id + ":" + model.id, value: JSON.stringify([provider.id, model.id]) }, model.name)),
              )),
            ),
            react.createElement("span", { className: "dsh-mj-model-badge", title: modelLabel }, modelLabel),
          )
          : react.createElement("div", { className: "dsh-mj-human-note" }, humanLabel),
        react.createElement("label", { className: "dsh-mj-field" },
          react.createElement("span", { className: "dsh-mj-label" }, "初始积分"),
          react.createElement("input", { className: "dsh-mj-input", type: "number", min: 0, max: 1000000, step: 1, required: true,
            value: seat.initialPoints, disabled: props.disabled, "aria-label": ["东", "南", "西", "北"][seat.seat] + "家初始积分",
            onChange: (event) => props.onInitialPoints(event.target.value) })),
      );
    }

    function SetupDialog(props) {
      var client = useController(props.controller);
      var draftPair = react.useState(initialDraft());
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var errorPair = react.useState(null);
      var localError = errorPair[0];
      var setLocalError = errorPair[1];
      var dialogRef = react.useRef(null);
      var titleRef = react.useRef(null);
      var sessions = props.useSessions((state) => state);
      var workspaces = props.useWorkspaces((state) => state);
      var models = flattenedModels(client.catalog);
      var starting = client.formStatus === "starting";
      var allAi = draft.seats.every((seat) => seat.kind === "ai");

      react.useEffect(() => {
        if (client.panelOpen && client.catalogStatus === "idle") props.controller.loadCatalog(false).catch(() => {});
      }, [client.panelOpen, client.catalogStatus]);
      react.useEffect(() => {
        if (client.catalogStatus === "ready") setDraft((current) => assignDefaultModels(current, client.catalog));
      }, [client.catalogStatus, client.catalog]);
      react.useEffect(() => {
        if (client.panelOpen) requestAnimationFrame(() => { if (titleRef.current) titleRef.current.focus(); });
      }, [client.panelOpen]);
      react.useEffect(()=>{
        if(client.practiceSource)setDraft(current=>Object.assign({},current,{tableName:"历史局面练习",ruleset:client.practiceSource.frame.ruleset,autoBuhua:client.practiceSource.frame.ruleOptions?.autoBuhua!==false}));
      },[client.practiceSource]);
      if (!client.panelOpen) return null;

      function updateSeat(index, updater) {
        setDraft((current) => Object.assign({}, current, {
          seats: current.seats.map((seat, seatIndex) => seatIndex === index ? updater(seat) : seat),
        }));
      }
      function humanOrder(index) {
        return draft.seats.slice(0, index).filter((seat) => seat.kind === "human").length;
      }
      async function onSubmit(event) {
        event.preventDefault();
        setLocalError(null);
        try {
          var payload = serializeDraft(draft);
          await props.controller.startGame(payload, resolveWorkspaceId(workspaces, sessions.current));
        } catch (error) {
          setLocalError(error instanceof Error ? error.message : "无法开始牌局");
        }
      }
      function onDialogKeyDown(event) {
        if (event.key === "Escape") { event.preventDefault(); props.controller.closePanel(); }
        else trapDialogFocus(event, dialogRef.current);
      }
      var errorMessage = localError || client.formError;
      var retryState = client.pendingSessionId ? client.statesBySession[client.pendingSessionId] : null;

      return react.createElement(
        "div",
        { className: "dsh-mj-dialog-layer", "data-dsh-mahjong-setup": "true", onMouseDown: (event) => { if (event.target === event.currentTarget) props.controller.closePanel(); } },
        react.createElement(
          "div",
          { ref: dialogRef, className: "dsh-mj-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-mj-dialog-title", onKeyDown: onDialogKeyDown },
          react.createElement(
            "header",
            { className: "dsh-mj-dialog-header" },
            react.createElement(
              "div",
              { className: "dsh-mj-title-group" },
              react.createElement("span", { className: "dsh-mj-brand-logo", title: "MJLab.ai", "aria-hidden": "true" }, react.createElement("img", { src: MJLAB_LOGO, alt: "", width: 34, height: 34, draggable: false })),
              react.createElement("div", null,
                react.createElement("h2", { id: "dsh-mj-dialog-title", className: "dsh-mj-dialog-title" }, client.practiceSource ? "从历史局面开始练习" : "开一桌麻将"),
                react.createElement("p", { className: "dsh-mj-dialog-subtitle" }, "真人与 AI 可自由混坐，每个 AI 独立使用所选模型")),
            ),
            react.createElement("button", { type: "button", className: "dsh-mj-icon-button", "aria-label": "关闭开桌面板", disabled: starting, onClick: () => props.controller.closePanel() }, icon("IconCloseOutline16", 16)),
          ),
          react.createElement(
            "form",
            { className: "dsh-mj-form", onSubmit },
            react.createElement("button",{type:"button",className:"dsh-mj-secondary",onClick:()=>props.controller.openLibrary()},"我的牌谱 · 导入 / 复盘 / 分享"),
            react.createElement("button",{type:"button",className:"dsh-mj-secondary",onClick:()=>props.controller.openSources()},"赛事案例 · 完整回放与讲解"),
            react.createElement("button",{type:"button",className:"dsh-mj-secondary",onClick:()=>props.controller.openLessons()},"教练课程"),
            react.createElement("div", { className: "dsh-mj-notice", style: { marginTop: 0, marginBottom: 18, alignItems: "center" } },
              react.createElement("span", { style: { flex: 1 } }, "牌谱模式 · 天府夺魁 8-8：LC 自摸三条（局部案例，只读）"),
              react.createElement("button", { type: "button", className: "dsh-mj-secondary", disabled: starting,
                onClick: () => props.controller.openCase(0, resolveWorkspaceId(workspaces, sessions.current)) }, "打开案例复盘")),
            react.createElement(
              "div",
              { className: "dsh-mj-form-grid" },
              react.createElement("label", { className: "dsh-mj-field" },
                react.createElement("span", { className: "dsh-mj-label" }, "玩法"),
                react.createElement("select", {className:"dsh-mj-input", value:draft.ruleset, disabled:starting||Boolean(client.practiceSource),
                  onChange:(event)=>setDraft(Object.assign({},draft,{ruleset:event.target.value}))},
                  react.createElement("option", {value:"blood"}, "血战到底 · 换三张、定缺"),
                  react.createElement("option", {value:"guobiao"}, "标准国标 · 81 番种、8 番起和"))),
              draft.ruleset === "guobiao" ? react.createElement("label", {className:"dsh-mj-field"},
                react.createElement("span", {className:"dsh-mj-label"}, "花牌处理"),
                react.createElement("select", {className:"dsh-mj-input",value:String(draft.autoBuhua),disabled:starting||Boolean(client.practiceSource),
                  onChange:(event)=>setDraft(Object.assign({},draft,{autoBuhua:event.target.value === "true"}))},
                  react.createElement("option", {value:"true"}, "自动补花"),react.createElement("option", {value:"false"}, "手动补花"))) : null,
              react.createElement("label", { className: "dsh-mj-field" },
                react.createElement("span", { className: "dsh-mj-label" }, "桌名"),
                react.createElement("input", { ref: titleRef, className: "dsh-mj-input", value: draft.tableName, maxLength: 40, disabled: starting, autoComplete: "off", onChange: (event) => setDraft(Object.assign({}, draft, { tableName: event.target.value })) })),
              react.createElement("label", { className: "dsh-mj-field" },
                react.createElement("span", { className: "dsh-mj-label" }, "出牌超时（秒）"),
                react.createElement("input", { className: "dsh-mj-input dsh-mj-timeout", type: "number", min: 10, max: 120, step: 1, value: draft.timeoutSeconds, disabled: starting, onChange: (event) => setDraft(Object.assign({}, draft, { timeoutSeconds: event.target.value })) })),
            ),
            react.createElement("div", { className: "dsh-mj-section-heading" }, react.createElement("h3", null, "四个座位"), react.createElement("span", null, "开局后锁定座位、模型与初始积分")),
            client.catalogStatus === "loading"
              ? react.createElement("div", { className: "dsh-mj-catalog-state", role: "status" }, react.createElement("span", { className: "dsh-mj-spinner", "aria-hidden": "true" }), "正在读取 Harness 已配置模型") : null,
            client.catalogStatus === "error"
              ? react.createElement("div", { className: "dsh-mj-error", role: "alert" }, icon("IconWarningOutline16", 16), react.createElement("span", null, client.catalogError || "模型目录加载失败"), react.createElement("button", { type: "button", className: "dsh-mj-secondary", onClick: () => props.controller.loadCatalog(true).catch(() => {}) }, icon("IconRefreshOutline14", 14), "重试")) : null,
            client.catalogStatus === "ready" && models.length === 0
              ? react.createElement("div", { className: "dsh-mj-catalog-state", role: "status" }, "暂无可用 AI 模型。可先开全真人牌局，或到设置 > 模型中完成配置。") : null,
            react.createElement(
              "div",
              { className: "dsh-mj-seats" },
              draft.seats.map((seat, index) => react.createElement(SeatCard, {
                key: seat.seat,
                seat,
                catalog: client.catalog,
                models,
                disabled: starting,
                humanOrder: humanOrder(index),
                onKind: (kind) => updateSeat(index, (current) => {
                  var next = Object.assign({}, current, { kind });
                  return kind === "ai" ? assignDefaultModels({ seats: [next] }, client.catalog).seats[0] : next;
                }),
                onModel: (value) => updateSeat(index, (current) => updateSeatModel(current, value, client.catalog)),
                onInitialPoints: (value) => updateSeat(index, (current) => Object.assign({}, current, { initialPoints: value })),
              })),
            ),
            allAi ? react.createElement("div", { className: "dsh-mj-notice", role: "status" }, icon("IconQuestionOutline14", 15), react.createElement("span", null, "四个座位均为 AI，你将作为旁观者观看整局。")) : null,
            errorMessage ? react.createElement("div", { className: "dsh-mj-error", role: "alert", "aria-live": "assertive" }, icon("IconWarningOutline16", 16), react.createElement("span", null, errorMessage)) : null,
            react.createElement(
              "div",
              { className: "dsh-mj-actions" },
              retryState && retryState.retryable ? react.createElement("button", { type: "button", className: "dsh-mj-secondary", disabled: starting, onClick: () => props.controller.retryGame(client.pendingSessionId) }, icon("IconRefreshOutline14", 14), "重试牌局") : null,
              react.createElement("button", { type: "button", className: "dsh-mj-secondary", disabled: starting, onClick: () => props.controller.closePanel() }, "取消"),
              react.createElement("button", { type: "submit", className: "dsh-mj-primary", disabled: starting }, starting ? react.createElement("span", { className: "dsh-mj-spinner", "aria-hidden": "true" }) : icon("IconPlayOutline16", 16), starting ? "正在开桌" : "开始"),
            ),
          ),
        ),
      );
    }

    function InviteDialog(props) {
      var client = useController(props.controller);
      var state = client.inviteSessionId && client.statesBySession[client.inviteSessionId];
      var invitations = state && state.phase === "active" && state.game && Array.isArray(state.game.seatInvites)
        ? state.game.seatInvites
        : [];
      var statusPair = react.useState("");
      var copyStatus = statusPair[0];
      var setCopyStatus = statusPair[1];
      var dialogRef = react.useRef(null);
      var closeRef = react.useRef(null);
      react.useEffect(() => {
        if (client.inviteSessionId) requestAnimationFrame(() => closeRef.current?.focus?.());
      }, [client.inviteSessionId]);
      if (!client.inviteSessionId || invitations.length === 0) return null;

      function expiryLabel(value) {
        if (!Number.isFinite(value)) return "短期有效";
        return "有效至 " + new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      }
      async function copyInvitation(invitation) {
        if (typeof invitation?.invitationUrl !== "string") return;
        try {
          var clipboard = window.navigator && window.navigator.clipboard;
          if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("clipboard unavailable");
          await clipboard.writeText(invitation.invitationUrl);
          setCopyStatus(["东", "南", "西", "北"][invitation.seat] + "家邀请链接已复制");
        } catch (_error) {
          setCopyStatus("浏览器未允许自动复制，请手动选择链接复制");
        }
      }
      function close() {
        setCopyStatus("");
        props.controller.closeInvites();
      }
      function onDialogKeyDown(event) {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else trapDialogFocus(event, dialogRef.current);
      }
      return react.createElement(
        "div",
        { className: "dsh-mj-dialog-layer", "data-dsh-mahjong-invites": "true", onMouseDown: (event) => { if (event.target === event.currentTarget) close(); } },
        react.createElement(
          "div",
          { ref: dialogRef, className: "dsh-mj-dialog dsh-mj-invite-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-mj-invite-title", onKeyDown: onDialogKeyDown },
          react.createElement(
            "header",
            { className: "dsh-mj-dialog-header" },
            react.createElement("div", null,
              react.createElement("h2", { id: "dsh-mj-invite-title", className: "dsh-mj-dialog-title" }, "邀请真人入座"),
              react.createElement("p", { className: "dsh-mj-dialog-subtitle" }, "每个链接只对应一个座位，请分别发送给对应玩家")),
            react.createElement("button", { ref: closeRef, type: "button", className: "dsh-mj-icon-button", "aria-label": "关闭邀请面板", onClick: close }, icon("IconCloseOutline16", 16)),
          ),
          react.createElement(
            "div",
            { className: "dsh-mj-invite-list" },
            react.createElement("p", { className: "dsh-mj-invite-help" }, "邀请链接包含短期、单座位凭证。对方直接打开即可入座；链接领取一次后失效，同一浏览器可以继续恢复牌局。"),
            invitations.map((invitation) => react.createElement(
              "div",
              { key: invitation.seat, className: "dsh-mj-invite-row" },
              react.createElement("span", { className: "dsh-mj-invite-seat" }, ["东", "南", "西", "北"][invitation.seat] + "家"),
              react.createElement("input", { className: "dsh-mj-input dsh-mj-invite-url", value: invitation.invitationUrl, readOnly: true, "aria-label": ["东", "南", "西", "北"][invitation.seat] + "家邀请链接，" + expiryLabel(invitation.expiresAtMs), onFocus: (event) => event.currentTarget.select() }),
              react.createElement("button", { type: "button", className: "dsh-mj-secondary", onClick: () => copyInvitation(invitation) }, icon("IconCopyOutline16", 15), "复制"),
              react.createElement("button",{type:"button",className:"dsh-mj-secondary",onClick:async()=>{try{await props.controller.replayAction("revokeSeat",{gameId:state.game.gameId,seat:invitation.seat});await props.controller.loadSession(client.inviteSessionId,true);setCopyStatus("旧邀请与连接已撤销，请使用新链接。");}catch(error){setCopyStatus(error.message);}}},"撤销并换新"),
            )),
            react.createElement("div", { className: "dsh-mj-copy-status", role: "status", "aria-live": "polite" }, copyStatus),
          ),
        ),
      );
    }

    function SourcesDialog(props){
      var client=useController(props.controller),workspaces=props.useWorkspaces(v=>v),sessions=props.useSessions(v=>v),ref=react.useRef(null);
      if(!client.sourcesOpen)return null;
      return react.createElement("div",{className:"dsh-mj-dialog-layer",onMouseDown:e=>{if(e.target===e.currentTarget)props.controller.closeSources();}},
        react.createElement("div",{className:"dsh-mj-dialog",role:"dialog","aria-modal":"true","aria-label":"赛事案例",ref,onKeyDown:e=>{if(e.key==="Escape")props.controller.closeSources();else trapDialogFocus(e,ref.current);}},
          react.createElement("header",{className:"dsh-mj-dialog-header"},react.createElement("h2",{className:"dsh-mj-dialog-title"},"赛事案例"),react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>props.controller.closeSources()},"关闭")),
          react.createElement("div",{className:"dsh-mj-form"},
            (client.sources??[]).map(c=>react.createElement("section",{key:c.caseId,style:{marginBottom:20}},
              react.createElement("h3",null,c.title),react.createElement("p",null,c.players.map(p=>p.name).join(" · ")+" · "+c.count+" 个回放时点"),
              react.createElement("p",{style:{fontSize:12}},c.notice),
              react.createElement("button",{className:"dsh-mj-secondary",disabled:client.formStatus==="starting",onClick:()=>props.controller.openSource(c.caseId,0,0,resolveWorkspaceId(workspaces,sessions.current))},"整副回放")," ",
              react.createElement("button",{className:"dsh-mj-secondary",disabled:client.formStatus==="starting"||!c.hasLessons,onClick:()=>props.controller.openSource(c.caseId,c.keyIndex,c.keySeat,resolveWorkspaceId(workspaces,sessions.current),0)},c.hasLessons?"关键步讲解":"讲解待复核"))),
            client.sources?.length===0?react.createElement("p",null,"本机尚未安装赛事案例。"):null,
            react.createElement("details",null,react.createElement("summary",null,"较早的局部案例"),react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>{props.controller.closeSources();props.controller.openCase(0,resolveWorkspaceId(workspaces,sessions.current));}},"天府夺魁 · LC 自摸三条（局部）")),
            client.formError?react.createElement("p",{role:"alert"},client.formError):null)));
    }
    var correctionPanelOpen=false;
    var correctionPreviewActive=false;
    var correctionPreview=null;
    var editTiles=[...'spm'].flatMap(s=>Array.from({length:9},(_,i)=>`${i+1}${s}`));
    var editActions={draw:'摸牌',discard:'弃牌',peng:'碰',gang_exposed:'明杠',gang_concealed:'暗杠',gang_added:'补杠',draw_replacement:'杠后补牌',hu_ron:'点炮胡',hu_tsumo:'自摸',end:'流局结束'};
    var editTileName=t=>/^[1-9][spm]$/.test(t)?'一二三四五六七八九'[+t[0]-1]+({s:'条',p:'筒',m:'万'}[t[1]]):'未选牌';
    var editSort=xs=>xs.slice().sort((a,b)=>editTiles.indexOf(a)-editTiles.indexOf(b));
    var editClone=x=>JSON.parse(JSON.stringify(x));
    var editH=(tag,props,...children)=>react.createElement(tag,props,...children);
    function editDrawPair(record,eventId,tile){
      var i=record.events.findIndex(e=>e.id===eventId),draw=record.events[i],discard=record.events[i+1];
      if(!draw||!['draw','draw_replacement'].includes(draw.action)||!/^([1-9])[spm]$/.test(tile)||tile===draw.tile||!discard||discard.action!=='discard'||discard.seat!==draw.seat)return null;
      return {drawId:draw.id,discardId:discard.id,drawSeq:i+1,discardSeq:i+2,seat:draw.seat,drawTile:draw.tile,discardTile:discard.tile,tile};
    }
    function editDrawChoice(record,pair,both){
      var current=editDrawPair(record,pair.drawId,pair.tile);
      if(!current||JSON.stringify(current)!==JSON.stringify(pair))throw new Error('关联步骤已变化，请重新选择要修改的摸牌。');
      var next=JSON.parse(JSON.stringify(record));next.events.find(e=>e.id===pair.drawId).tile=pair.tile;
      if(both)next.events.find(e=>e.id===pair.discardId).tile=pair.tile;
      return next;
    }
    function editRestoredDraft(data,local){
      // This tab's cache contains the latest edit, even if an older request
      // reached the server later. A clean cache also cancels an older draft.
      var draft=local??data.draft;
      if(!draft||JSON.stringify(draft.record)===JSON.stringify(data.record)&&(!draft.reason||draft.reason==='纠正牌谱'))return null;
      return draft;
    }
    function editDraftWriter(write){
      var pending=Promise.resolve();
      return payload=>{var next=pending.catch(()=>{}).then(()=>write(payload));pending=next;return next;};
    }
    function editorLayout(scroller,composer,mode,preference){
      if(!correctionPanelOpen)return calculateStageGeometry(scroller,composer,mode,preference);
      var rect=scroller.getBoundingClientRect(),panel=document.querySelector('.dsh-mj-correction')?.getBoundingClientRect();
      if(!panel)return calculateStageGeometry(scroller,composer,mode,preference);
      var small=window.innerWidth<1000,right=small?rect.right:panel.left-12,bottom=small?panel.top-28:(composer?.getBoundingClientRect().top??rect.bottom);
      var w=Math.max(0,Math.min(right-rect.left,(bottom-rect.top)*TABLE_RATIO));
      return {left:rect.left+(right-rect.left-w)/2,top:rect.top,width:w,height:w/TABLE_RATIO};
    }
    function applyEditorFrame(frame,count){
      return new Promise((resolve,reject)=>{
        var iframe=document.querySelector('.dsh-mj-frame'),target=iframe?.contentWindow;
        if(!target||!frame){reject(new Error('牌桌尚未就绪'));return;}
        var origin=new URL(iframe.src,location.href).origin,id=crypto.randomUUID();
        var timer=setTimeout(()=>finish(new Error('已保存，回放加载失败。请点击重试加载。')),8000);
        function finish(error){clearTimeout(timer);window.removeEventListener('message',receive);error?reject(error):resolve();}
        function receive(e){if(e.source===target&&e.origin===origin&&e.data?.type==='dsh-mahjong:history-applied'&&e.data.requestId===id&&e.data.gameId===frame.gameId&&e.data.eventIndex===frame.eventIndex)finish();}
        window.addEventListener('message',receive);
        target.postMessage({type:'dsh-mahjong:history-frame',frame,count,first:0,requestId:id},origin);
      });
    }
    function EditTileList({label,tiles,onChange}){
      return editH('fieldset',{className:'dsh-edit-tiles'},editH('legend',null,label+' · '+tiles.length+'张'),
        editH('div',{className:'dsh-edit-row'},...editSort(tiles).map((t,i)=>editH('button',{key:i,type:'button',title:'移除'+editTileName(t),'aria-label':label+'移除'+editTileName(t),onClick:()=>{var n=tiles.slice();n.splice(n.indexOf(t),1);onChange(n);}},editTileName(t),' ×')),
          editH('select',{'aria-label':label+'添加牌',value:'',onChange:e=>{if(e.target.value)onChange(editSort([...tiles,e.target.value]));}},editH('option',{value:''},'＋ 添加牌'),...editTiles.map(t=>editH('option',{key:t,value:t},editTileName(t))))));
    }
    function editSummary(value,players){
      if(value===undefined||value===null)return '无';
      if(Array.isArray(value))return value.map(v=>editSummary(v,players)).join('；');
      if(typeof value==='object'){
        if(value.action)return '事件 '+value.seq+' · '+(players?.[value.seat]?.name??'玩家')+' '+(editActions[value.action]??value.action)+' '+(value.tile?editTileName(value.tile):'')+' · '+value.atSeconds+'秒'+(value.triggerEventId?' · 来源 '+value.triggerEventId:'')+(value.meldEventId?' · 原碰 '+value.meldEventId:'')+(value.scoreTransfers?.length?' · 转账 '+editSummary(value.scoreTransfers,players):'')+(value.evidence?' · 证据：'+({unverified:'未核实','user-corrected':'用户更正','direct-observation':'直接观察',inferred:'连续状态推定',video_observed:'原谱标为视频观察（尚待复核）',uniquely_inferred:'原谱标为连续状态推定'}[value.evidence.kind]??value.evidence.kind)+'；'+(value.evidence.explanation??'')+(value.evidence.reference?'；依据：'+value.evidence.reference:''):'');
        if(value.fromSeat!==undefined&&value.toSeat!==undefined)return (players?.[value.fromSeat]?.name??value.fromSeat)+' → '+(players?.[value.toSeat]?.name??value.toSeat)+' '+(value.tiles?value.tiles.map(editTileName).join('、'):value.points+'分');
        var names={seat:'座位',name:'昵称',dingque:'定缺',dealtHand:'换牌前',openingHand:'换牌后',initialHandPoints:'初始分',transfers:'换牌',direction:'方向',explanation:'说明',kind:'证据状态',sourceRange:'时间范围',eventId:'关联事件',area:'区域',tiles:'实见牌',scope:'可见范围',atSeconds:'视频秒数'};
        return Object.entries(value).map(([k,v])=>(names[k]??k)+'：'+editSummary(v,players)).join('；');
      }
      if(editTiles.includes(value))return editTileName(value);
      return String(value);
    }
    function editChanges(a,b){
      if(!a||!b)return [];var rows=[];
      for(var key of new Set([...Object.keys(a),...Object.keys(b)]))if(!['events','version','verification','settlement','settlementBySeat','unplayedWall','revisionHistory'].includes(key)&&JSON.stringify(a[key])!==JSON.stringify(b[key]))rows.push({label:({players:'玩家与手牌',dealer:'庄家',exchange:'换三张',observations:'视频核对',source:'来源',timing:'阶段时间',title:'标题',scoring:'计分说明',ruleset:'规则',dingqueSourceRange:'定缺时间范围',championIdentity:'冠军身份依据'})[key]??key,before:a[key],after:b[key]});
      var old=new Map(a.events.map(e=>[e.id,e])),next=new Map(b.events.map(e=>[e.id,e]));
      for(var id of new Set([...old.keys(),...next.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(next.get(id)))rows.push({label:'事件 '+(next.get(id)?.seq??old.get(id)?.seq),before:old.get(id),after:next.get(id)});
      return rows;
    }
    function SourceCorrectionEditor(props){
      var h=editH,source=props.game.sourceReplay;
      var [loaded,setLoaded]=react.useState(null),[record,setRecord]=react.useState(null),[selected,setSelected]=react.useState(source.items[props.game.historyIndex]?.eventId??'phase-dealt');
      var [tab,setTab]=react.useState('event'),[busy,setBusy]=react.useState(false),[status,setStatus]=react.useState('正在读取牌谱…'),[validation,setValidation]=react.useState(null),[reason,setReason]=react.useState('纠正牌谱');
      var [undo,setUndo]=react.useState([]),[redo,setRedo]=react.useState([]),[video,setVideo]=react.useState(null),[retry,setRetry]=react.useState(false),[diffVersion,setDiffVersion]=react.useState(null);
      var [pendingPair,setPendingPair]=react.useState(null);
      var errorsRef=react.useRef(null);
      react.useEffect(()=>{if(pendingPair){var box=document.querySelector('[aria-label="关联摸打更正"]');box?.scrollIntoView({block:'nearest'});box?.querySelector('button')?.focus();}},[pendingPair]);
      var videoRef=react.useRef(null),latest=react.useRef(null),operation=react.useRef(null),alive=react.useRef(true);
      var clientId=react.useMemo(()=>{var key='dsh-source-editor-client',id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id);}return id;},[]);
      var localKey='dsh-source-draft:'+source.caseId+':'+clientId;
      var call=(op,input={})=>props.controller.sourceEditorRequest(op,{sessionId:props.sessionId,...input});
      var writeDraft=react.useMemo(()=>editDraftWriter(payload=>call('draft',payload)),[props.sessionId]);
      var persistDraft=()=>writeDraft(draftPayload());
      var currentFrame=()=>{var g=props.controller.getSnapshot().statesBySession[props.sessionId]?.game;return g?applyEditorFrame(g.historyFrame,g.historyCount):Promise.resolve();};
      react.useEffect(()=>{
        alive.current=true;correctionPanelOpen=true;document.documentElement.setAttribute('data-dsh-source-editing','true');window.dispatchEvent(new Event('dsh-correction-layout'));
        call('get',{clientId}).then(data=>{
          if(!alive.current)return;var local=null;
          try{local=JSON.parse(localStorage.getItem(localKey));}catch(_){}
          var draft=editRestoredDraft(data,local);
          setLoaded({...data,baseHash:draft?.baseHash??data.baseHash,diskHash:draft?.diskHash??data.diskHash});setRecord(draft?.record??data.record);
          if(draft?.selection)setSelected(draft.selection);if(draft?.reason)setReason(draft.reason);
          setStatus(draft?'已恢复未提交草稿；当前正式回放未改变。':data.externalChanged?'源文件有外部修改，请先重新读取并比较。':'当前正式版本 v'+(data.record.version??1)+' · 视频核对未完成');
        }).catch(e=>setStatus(e.message));
        return()=>{alive.current=false;if(latest.current?.record&&latest.current?.loaded)persistDraft().catch(()=>{});correctionPanelOpen=false;document.documentElement.removeAttribute('data-dsh-source-editing');correctionPreviewActive=false;window.dispatchEvent(new Event('dsh-correction-layout'));currentFrame().catch(()=>{});};
      },[]);
      react.useEffect(()=>()=>{if(video)URL.revokeObjectURL(video);},[video]);
      latest.current={record,loaded,selected,reason};
      function draftPayload(){var x=latest.current;return {clientId,record:x.record,baseHash:x.loaded.baseHash,diskHash:x.loaded.diskHash,selection:x.selected,reason:x.reason};}
      react.useEffect(()=>{
        if(!loaded||!record)return;
        // Persist the baseline too: undoing every change must supersede a
        // previously saved draft instead of resurrecting it on the next open.
        var draft={...draftPayload(),at:new Date().toISOString()};
        try{localStorage.setItem(localKey,JSON.stringify(draft));}catch(e){setStatus('浏览器草稿空间不足，请使用保存草稿。');}
        if(busy)return;var timer=setTimeout(()=>persistDraft().catch(e=>{if(alive.current)setStatus('自动保存草稿失败：'+e.message);}),650);
        return()=>clearTimeout(timer);
      },[record,loaded,selected,busy,reason]);
      function change(fn){var next=editClone(record);fn(next);next.events.forEach((e,i)=>e.seq=i+1);setUndo(u=>[...u.slice(-49),editClone(record)]);setRedo([]);setRecord(next);setValidation(null);setPendingPair(null);operation.current=null;setStatus('草稿已修改，尚未生效；可继续修改其他事件，再统一校验。');}
      function navigate(id){if(busy||pendingPair)return;setSelected(id);if(validation?.ok)setValidation(null);setStatus(validation&&!validation.ok?'已定位。可继续修改；下方保留上次校验的差异提示。':'已切换编辑事件，请校验并预览查看对应草稿画面。');}
      function jumpToEvent(id){if(!record.events.some(e=>e.id===id)){setStatus('该事件已删除，请检查修改对比。');return;}setTab('event');navigate(id);document.querySelector('.dsh-edit-body')?.scrollTo({top:0});}
      function editEvent(patch){change(r=>Object.assign(r.events.find(e=>e.id===selected),patch));}
      function editEventTile(tile){var pair=editDrawPair(record,selected,tile);if(pair){setPendingPair(pair);setStatus('请选择只改摸牌，或将关联摸打一起更正。');}else editEvent({tile});}
      function choosePair(both){try{var next=editDrawChoice(record,pendingPair,both);change(r=>Object.assign(r,next));setStatus(both?'摸牌和弃牌已作为一组修改，点击一次撤销可恢复两步。':'已只修改摸牌，关联弃牌保持当前记录；可继续编辑后统一校验。');}catch(error){setPendingPair(null);setStatus(error.message);}}
      async function run(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){setStatus(e.message);}finally{if(alive.current)setBusy(false);}}
      function indexFor(r,id){if(id==='phase-dealt')return 0;if(id==='phase-exchanged')return 1;if(id==='phase-dingque')return 2;if(id==='phase-settlement')return r.events.length+3;return Math.max(0,r.events.findIndex(e=>e.id===id)+3);}
      async function preview(r=record){
        var result=await call('validate',{record:r,eventIndex:indexFor(r,selected),baseHash:loaded.baseHash});setValidation(result);
        if(!result.ok){setStatus('校验未通过；已列出出错位置、本次修改和可比较的手牌差异。可以保存草稿继续修改。');correctionPreviewActive=false;setTimeout(()=>errorsRef.current?.scrollIntoView({block:'nearest'}),0);await currentFrame();return;}
        correctionPreview={frame:result.preview,count:result.count};correctionPreviewActive=true;await applyEditorFrame(result.preview,result.count);
        setStatus('草稿预览 · '+(r.players.find(p=>p.seat===result.preview.perspective.seat)?.name??'玩家')+'视角 · 未生效。数据校验通过；视频核对未完成。');
      }
      async function commit(){
        if(!validation?.ok)return;await persistDraft();
        operation.current??=crypto.randomUUID();
        var result=await call('commit',{...draftPayload(),selection:undefined,operationId:operation.current,reason,selectedEventId:selected});
        if(!result.saved){setValidation(result);setStatus('校验未通过，草稿已保留。');return;}
        correctionPreviewActive=false;setRetry(true);
        try{await applyEditorFrame(result.state.game.historyFrame,result.state.game.historyCount);setRetry(false);setStatus('已更新回放 · v'+result.version+'；视频核对未完成，旧讲解待复核。');}
        catch(e){setStatus(e.message);}
        var fresh=await call('get',{clientId});setLoaded(fresh);setRecord(fresh.record);setSelected(result.state.game.sourceReplay.items[result.state.game.historyIndex].eventId);setValidation(null);setUndo([]);setRedo([]);setReason('纠正牌谱');operation.current=null;localStorage.removeItem(localKey);
      }
      var btn=(text,fn,disabled=false,primary=false)=>h('button',{type:'button',className:primary?'dsh-edit-primary':'',disabled:busy||!!pendingPair||disabled,onClick:fn},text);
      var select=(label,value,options,onChange)=>h('label',{className:'dsh-edit-field'},h('span',null,label),h('select',{'aria-label':label,disabled:busy||!!pendingPair,value:value??'',onChange:e=>onChange(e.target.value)},...options.map(([v,text])=>h('option',{key:v,value:v},text))));
      var input=(label,value,onChange,type='text')=>h('label',{className:'dsh-edit-field'},h('span',null,label),h('input',{'aria-label':label,disabled:busy||!!pendingPair,type,value:value??'',step:type==='number'?'any':undefined,onChange:e=>onChange(type==='number'?Number(e.target.value):e.target.value)}));
      if(!record)return h('aside',{className:'dsh-mj-correction','aria-label':'牌谱纠错'},h('header',null,h('strong',null,'牌谱纠错'),btn('关闭',props.onClose)),h('p',{role:'status'},status));
      var e=record.events.find(e=>e.id===selected),ei=record.events.findIndex(e=>e.id===selected),players=record.players,seats=players.map(p=>[p.seat,p.name]);
      var stages=[['phase-dealt','换牌前'],['phase-exchanged','换牌后'],['phase-dingque','定缺完成']];
      var eventOptions=[...stages,...record.events.map((x,i)=>[x.id,'事件 '+(i+1)+' · '+players[x.seat]?.name+' '+editActions[x.action]+' '+(x.tile?editTileName(x.tile):'')]),['phase-settlement','本副结算']];
      var changes=editChanges(loaded.record,record);
      var diagnosis=validation?.diagnostics;
      var describeEvent=x=>x?(players[x.seat]?.name??'玩家')+' '+(editActions[x.action]??x.action)+' '+(x.tile?editTileName(x.tile):'')+'（'+x.atSeconds+'秒）':'无';
      var countTiles=tiles=>[...new Set(tiles)].map(t=>tiles.filter(x=>x===t).length+'张'+editTileName(t)).join('、');
      var at=e?.atSeconds??({['phase-dealt']:record.timing?.dealt??record.exchange.sourceRange?.[0],['phase-exchanged']:record.timing?.exchanged??record.exchange.sourceRange?.[1],['phase-dingque']:record.timing?.dingque??record.dingqueSourceRange?.[1],['phase-settlement']:record.timing?.settlement??record.events.at(-1)?.atSeconds})[selected]??0;
      var differences=rows=>h('div',{className:'dsh-edit-diffs'},...rows.map((row,i)=>h('details',{key:i},h('summary',null,row.label),h('p',null,'修改前：'+editSummary(row.before,players)),h('p',null,'修改后：'+editSummary(row.after,players)))));
      function insert(after){var id='event-'+crypto.randomUUID();change(r=>r.events.splice(ei<0?0:ei+(after?1:0),0,{id,seat:e?.seat??0,action:'draw',tile:'',atSeconds:at,evidence:{kind:'unverified',explanation:''}}));setSelected(id);setTab('event');}
      function swapSeats(a,b){
        change(r=>{
          var remap=n=>n===a?b:n===b?a:n;
          r.players.forEach(p=>p.seat=remap(p.seat));r.players.sort((x,y)=>x.seat-y.seat);r.dealer=remap(r.dealer);
          r.exchange.transfers.forEach(t=>{t.fromSeat=remap(t.fromSeat);t.toSeat=remap(t.toSeat);});
          r.events.forEach(x=>{x.seat=remap(x.seat);if(x.fromSeat!==undefined)x.fromSeat=remap(x.fromSeat);x.scoreTransfers?.forEach(t=>{t.fromSeat=remap(t.fromSeat);t.toSeat=remap(t.toSeat);});});
          r.observations?.forEach(o=>o.seat=remap(o.seat));
        });
      }
      function recalculateOpening(){
        var hands=players.map(p=>p.dealtHand.slice()),transfers=record.exchange.transfers;
        for(var t of transfers)for(var tile of t.tiles){var pos=hands[t.fromSeat].indexOf(tile);if(pos<0)throw new Error(players[t.fromSeat].name+'换牌前没有'+editTileName(tile));hands[t.fromSeat].splice(pos,1);}
        for(var t of transfers)hands[t.toSeat].push(...t.tiles);
        change(r=>r.players.forEach((p,i)=>p.openingHand=editSort(hands[i])));
      }
      var eventPanel=e?h('section',null,
        h('p',{className:'dsh-edit-context'},'回放第 '+(indexFor(record,selected)+1)+' 步 ／ 行牌事件 '+(ei+1)+' ／ '+players[e.seat]?.name+' ／ '+editActions[e.action]+' ／ '+at+' 秒'),
        h('div',{className:'dsh-edit-grid'},select('行动玩家',e.seat,seats,v=>editEvent({seat:+v})),select('动作',e.action,Object.entries(editActions),v=>editEvent({action:v})),select('牌张',e.tile,[['','请选择'],...editTiles.map(t=>[t,editTileName(t)])],editEventTile),input('视频时间（秒）',e.atSeconds,v=>editEvent({atSeconds:v}),'number')),
        ['peng','gang_exposed','hu_ron'].includes(e.action)?select('关联弃牌',e.triggerEventId,[['','请选择来源'],...record.events.slice(0,ei).filter(x=>x.action==='discard').map(x=>[x.id,'事件 '+x.seq+' · '+players[x.seat].name+'打'+editTileName(x.tile)])],v=>{var from=record.events.find(x=>x.id===v);editEvent({triggerEventId:v,triggerSeq:from?.seq,fromSeat:from?.seat});}):null,
        e.action==='gang_added'?select('关联原碰牌',e.meldEventId,[['','请选择副露'],...record.events.slice(0,ei).filter(x=>x.action==='peng'&&x.seat===e.seat).map(x=>[x.id,'事件 '+x.seq+' · 碰'+editTileName(x.tile)])],v=>editEvent({meldEventId:v})):null,
        h('div',{className:'dsh-edit-grid'},select('证据状态',e.evidence?.kind??'unverified',[['unverified','未核实'],['user-corrected','用户更正'],['direct-observation','直接观察'],['inferred','连续状态推定'],['video_observed','原谱标为视频观察（尚待复核）'],['uniquely_inferred','原谱标为连续状态推定']],v=>editEvent({evidence:{...e.evidence,kind:v}})),input('截图位置或文字依据',e.evidence?.reference??'',v=>editEvent({evidence:{...e.evidence,reference:v}}))),
        input('此步说明',e.evidence?.explanation??'',v=>editEvent({evidence:{...e.evidence,explanation:v}})),
        h('h3',null,'此步积分转账'),...(e.scoreTransfers??[]).map((t,i)=>h('div',{key:i,className:'dsh-edit-transfer'},select('付款方 '+(i+1),t.fromSeat,seats,v=>change(r=>r.events[ei].scoreTransfers[i].fromSeat=+v)),select('收款方 '+(i+1),t.toSeat,seats,v=>change(r=>r.events[ei].scoreTransfers[i].toSeat=+v)),input('分数 '+(i+1),t.points,v=>change(r=>r.events[ei].scoreTransfers[i].points=v),'number'),btn('移除',()=>change(r=>r.events[ei].scoreTransfers.splice(i,1))))),btn('添加转账',()=>editEvent({scoreTransfers:[...(e.scoreTransfers??[]),{fromSeat:(e.seat+1)%4,toSeat:e.seat,points:1}]})),
        h('p',{className:'dsh-edit-muted'},'终局积分由初始分及转账计算；本功能不替代赛事番型核验。'),
        h('div',{className:'dsh-edit-row'},btn('前插动作',()=>insert(false)),btn('后插动作',()=>insert(true)),btn('上移',()=>change(r=>{[r.events[ei-1],r.events[ei]]=[r.events[ei],r.events[ei-1]];}),ei===0),btn('下移',()=>change(r=>{[r.events[ei+1],r.events[ei]]=[r.events[ei],r.events[ei+1]];}),ei===record.events.length-1),btn('删除动作',()=>{change(r=>r.events.splice(ei,1));setSelected(record.events[ei-1]?.id??'phase-dingque');})))
        :h('section',null,h('p',null,'当前是'+(eventOptions.find(x=>x[0]===selected)?.[1]??'开局阶段')+'。在“玩家与换牌”编辑起手、换牌和定缺。'),btn('插入行牌动作',()=>insert(false)));
      var playersPanel=h('section',null,
        select('庄家',record.dealer,seats,v=>change(r=>r.dealer=+v)),h('p',{className:'dsh-edit-muted'},'座位 1—4 按行牌顺序。昵称只修改显示身份；更换庄家或手牌会重新校验全局归属。'),
        ...players.map((p,i)=>h('details',{key:i,open:i===0},h('summary',null,'座位 '+(i+1)+' · '+p.name),h('div',{className:'dsh-edit-grid'},input('座位 '+(i+1)+' 昵称',p.name,v=>change(r=>r.players[i].name=v)),select(p.name+'定缺',p.dingque,[['s','缺条'],['p','缺筒'],['m','缺万']],v=>change(r=>r.players[i].dingque=v)),input(p.name+'初始分',p.initialHandPoints??0,v=>change(r=>r.players[i].initialHandPoints=v),'number')),h(EditTileList,{label:p.name+'换牌前手牌',tiles:p.dealtHand,onChange:v=>change(r=>r.players[i].dealtHand=v)}),h('p',null,'换牌后记录：'+p.openingHand.map(editTileName).join('、')),select(p.name+'交换座位','',[['','选择交换对象'],...players.filter(x=>x.seat!==i).map(x=>[x.seat,'与座位 '+(x.seat+1)+' '+x.name+' 交换'])],v=>{if(v!=='')swapSeats(i,+v);}),h('p',{className:'dsh-edit-muted'},'交换会移动双方起手、定缺、全部行动、转账及观察归属；需重新检查行牌顺序和换牌方向。'))),
        h('h3',null,'换三张'),select('换牌方向',record.exchange.direction,[['previous_in_turn_order','交给行牌顺序的上一家'],['next_in_turn_order','交给行牌顺序的下一家'],['opposite','交给对家']],v=>change(r=>{r.exchange.direction=v;var offset={previous_in_turn_order:3,next_in_turn_order:1,opposite:2}[v];r.exchange.transfers.forEach(t=>t.toSeat=(t.fromSeat+offset)%4);})),
        ...record.exchange.transfers.map((t,i)=>h('div',{key:i},h('p',null,players[t.fromSeat].name+' → '+players[t.toSeat].name),h(EditTileList,{label:players[t.fromSeat].name+'换出',tiles:t.tiles,onChange:v=>change(r=>r.exchange.transfers[i].tiles=v)}))),
        btn('按起手与换牌更新换后记录',()=>run(async()=>recalculateOpening())),h('p',{className:'dsh-edit-muted'},'这个按钮明确更新计算记录。视频中实际看到的换后手牌，请另录为“视频实见核对”，不覆盖原始观察。'),
        h('h3',null,'阶段时间（秒）'),h('div',{className:'dsh-edit-grid'},...['dealt','exchanged','dingque','settlement'].map((key,i)=>input(['发牌完成','换牌完成','定缺完成','结算时间'][i],record.timing?.[key]??[record.exchange.sourceRange?.[0],record.exchange.sourceRange?.[1],record.dingqueSourceRange?.[1],record.events.at(-1)?.atSeconds][i],v=>change(r=>{r.timing??={};r.timing[key]=v;}),'number'))));
      var observationsPanel=h('section',null,h('p',null,'只填写视频中亲眼看到的牌。遮挡部分选“部分可见”，不要抄计算快照当作观察。'),
        btn('新增实见核对',()=>change(r=>(r.observations??=[]).push({id:'obs-'+crypto.randomUUID(),eventId:selected,seat:e?.seat??source.seat,area:'hand',scope:'partial',tiles:[],atSeconds:at,evidence:{kind:'direct-observation',explanation:''}}))),
        ...(record.observations??[]).map((o,i)=>{var upd=patch=>change(r=>Object.assign(r.observations[i],patch)),result=validation?.observationResults?.find(x=>x.id===o.id);return h('details',{key:o.id,open:true},h('summary',null,'核对 '+(i+1)+' · '+players[o.seat]?.name+(result?' · '+({match:'实见牌与计算值相符',mismatch:'实见牌与计算值不符',missing:'原事件已删除'})[result.status]:'')),select('核对步骤 '+(i+1),o.eventId,eventOptions,v=>upd({eventId:v})),h('div',{className:'dsh-edit-grid'},select('核对玩家 '+(i+1),o.seat,seats,v=>upd({seat:+v})),select('核对区域 '+(i+1),o.area,[['hand','手牌'],['river','牌河（不含被碰胡取走的牌）'],['meld','副露']],v=>upd({area:v})),select('可见范围 '+(i+1),o.scope,[['partial','部分可见'],['complete','完整可见']],v=>upd({scope:v})),input('核对视频秒数 '+(i+1),o.atSeconds,v=>upd({atSeconds:v}),'number')),h(EditTileList,{label:'实见牌 '+(i+1),tiles:o.tiles,onChange:v=>upd({tiles:v})}),input('核对依据 '+(i+1),o.evidence?.explanation??'',v=>upd({evidence:{kind:'direct-observation',explanation:v}})),result?.actual?h('p',null,'计算结果：'+result.actual.map(editTileName).join('、')):null,btn('删除核对',()=>change(r=>r.observations.splice(i,1))));}));
      var versionPanel=h('section',null,
        h('p',null,'载入历史版本后，先预览差异再保存。恢复会新增版本，中间历史保留。'),
        ...(loaded.versions??[]).map(v=>h('div',{key:v.hash,className:'dsh-edit-version'},
          h('strong',null,'v'+v.version+' · '+v.reason),h('small',null,v.at?new Date(v.at).toLocaleString():'编辑前版本'),
          h('div',{className:'dsh-edit-row'},
            btn('查看改动',()=>setDiffVersion(v)),
            btn('载入此版本草稿',()=>run(async()=>{
              var old=await call('version',{versionHash:v.hash});change(r=>{for(var k of Object.keys(r))delete r[k];Object.assign(r,old.record);});
              setReason('恢复至牌谱 v'+v.version);setStatus('历史版本已载入草稿，校验并预览后可保存为新版本。');
            }))
          )
        )),
        diffVersion?h('section',null,h('h3',null,'v'+diffVersion.version+' 的修改'),
          differences((diffVersion.changes??[]).map(x=>({...x,label:x.eventId?'事件 '+(x.after?.seq??x.before?.seq):({players:'玩家',exchange:'换牌',dealer:'庄家',observations:'视频核对',source:'来源'})[x.field]??x.field})))
        ):null
      );
      return h('aside',{className:'dsh-mj-correction','aria-label':'牌谱纠错',onKeyDown:ev=>{if(ev.key==='Escape'&&!busy)props.onClose();}},
        h('header',null,h('div',null,h('strong',null,'牌谱纠错'),h('small',null,'v'+(loaded.record.version??1)+' · '+(correctionPreviewActive?'草稿预览 · 未生效':'正式回放'))),btn('取消',props.onClose)),
        h('nav',{'aria-label':'纠错栏目'},...Object.entries({event:'行牌事件',players:'玩家与换牌',observations:'视频实见核对',versions:'版本记录'}).map(([key,label])=>h('button',{key,type:'button',disabled:busy||!!pendingPair,'aria-pressed':tab===key,onClick:()=>setTab(key)},label))),
        h('div',{className:'dsh-edit-body'},select('纠错步骤',selected,eventOptions,navigate),
          h('div',{className:'dsh-edit-row'},btn('撤销',()=>{operation.current=null;setRedo(x=>[...x,record]);setRecord(undo.at(-1));setUndo(x=>x.slice(0,-1));setValidation(null);setStatus('已撤销上一次修改；关联摸打作为一组恢复。');},!undo.length),btn('重做',()=>{operation.current=null;setUndo(x=>[...x,record]);setRecord(redo.at(-1));setRedo(x=>x.slice(0,-1));setValidation(null);setStatus('已重做上一次修改，请重新校验。');},!redo.length)),
          pendingPair?h('section',{role:'group','aria-label':'关联摸打更正',style:{padding:12,border:'1px solid var(--dsw-alias-border-l2,#ddd)',borderRadius:6,background:'var(--dsw-alias-bg-layer-2,#f5f5f5)'}},
            h('strong',null,'检查关联弃牌'),
            h('p',{'aria-live':'polite'},'准备将事件 '+pendingPair.drawSeq+' 的摸牌从'+editTileName(pendingPair.drawTile)+'改为'+editTileName(pendingPair.tile)+'。事件 '+pendingPair.discardSeq+' 当前记录为弃'+editTileName(pendingPair.discardTile)+'，是否也需要更正？'),
            h('p',{className:'dsh-edit-muted'},'请按原视频选择；摸到一张牌后，也可以打出手里的其他牌。'),
            h('div',{className:'dsh-edit-row'},h('button',{type:'button',disabled:busy,onClick:()=>choosePair(false)},'只改摸牌'),h('button',{type:'button',disabled:busy,onClick:()=>choosePair(true)},'摸打都改为'+editTileName(pendingPair.tile)),h('button',{type:'button',disabled:busy,onClick:()=>{setPendingPair(null);setStatus('已取消这次修改，草稿保持原样。');}},'取消这次修改'))):null,
          h('fieldset',{disabled:busy||!!pendingPair,className:'dsh-edit-content'},({event:eventPanel,players:playersPanel,observations:observationsPanel,versions:versionPanel})[tab]),
          h('details',null,h('summary',null,'原视频与源文件'),h('p',{className:'dsh-edit-path'},loaded.sourcePath),h('p',null,record.source?.url?h('a',{href:record.source.url,target:'_blank',rel:'noreferrer'},'打开原始视频出处'):null),
            h('div',{className:'dsh-edit-row'},loaded.hasVideo?btn('打开已关联视频',()=>run(async()=>{setStatus('正在读取本地视频…');var blob=await props.controller.sourceEditorVideo(props.sessionId);setVideo(URL.createObjectURL(blob));setStatus('视频已打开，可定位当前步骤。');})):null,h('label',null,'补选本地视频 ',h('input',{type:'file',accept:'video/*','aria-label':'补选本地视频',onChange:ev=>{var file=ev.target.files?.[0];if(file)setVideo(URL.createObjectURL(file));}}))),
            video?h('div',null,h('video',{ref:videoRef,src:video,controls:true,preload:'metadata',onLoadedMetadata:()=>{if(videoRef.current)videoRef.current.currentTime=at;}}),btn('定位当前步骤 '+at+' 秒',()=>{videoRef.current.currentTime=at;videoRef.current.pause();})):h('p',{className:'dsh-edit-muted'},'视频未在面板打开；这不妨碍保存草稿。'),
            btn('重新读取源文件',()=>run(async()=>{var fresh=await call('get',{clientId}),disk=await call('reread');setUndo(x=>[...x,record]);setRedo([]);setLoaded({...fresh,diskHash:disk.diskHash});setRecord(disk.record);setValidation(null);setStatus('已读取源文件到草稿。请展开修改对比，校验后再保存。');})),btn('导出当前草稿',()=>{var url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=source.caseId+'-草稿.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})),
          h('details',{open:changes.length>0},h('summary',null,'修改对比 · '+changes.length+' 项'),differences(changes),changes.length?h('p',{className:'dsh-edit-muted'},'修改会重新计算后续手牌、牌河、副露、余牌和积分；该案例的旧讲解及挑战依据需重新核对。'):h('p',null,'尚无修改。')),
          validation?.issues?.length?h('section',{className:'dsh-edit-errors',role:'alert',ref:errorsRef},
            h('h3',null,'校验未通过'),...validation.issues.map((x,i)=>h('div',{key:i},h('strong',null,(x.seq?'事件 '+x.seq+' · ':'')+(players[x.seat]?.name??'')+'：'+x.message),x.expected?h('p',null,'应为：'+x.expected.map(editTileName).join('、')+'；记录：'+(x.actual??[]).map(editTileName).join('、')):null,x.eventId?btn('定位错误事件',()=>jumpToEvent(x.eventId)):btn('检查起手与换牌',()=>setTab('players')),x.seq>1?btn('检查前一步',()=>jumpToEvent(record.events[x.seq-2]?.id)):null)),
            diagnosis?h('div',{'data-dsh-edit-diagnostics':true},
              h('h3',null,'与修改前'+(diagnosis.baselineVersion?' v'+diagnosis.baselineVersion:'')+' 对照'),
              h('p',null,'本次修改了 '+diagnosis.changes.length+' 条行牌事件。'),
              ...diagnosis.changes.map(x=>h('div',{key:x.eventId},h('p',null,'事件 '+x.seq+'：'+describeEvent(x.before)+' → '+describeEvent(x.after)),h('small',null,'修改项目：'+x.fields.map(k=>({seat:'行动玩家',action:'动作',tile:'牌张',fromSeat:'来源玩家',triggerEventId:'关联弃牌',meldEventId:'关联原碰',atSeconds:'时间',scoreTransfers:'积分转账',added:'新增动作',deleted:'删除动作',order:'顺序'})[k]??k).join('、')),x.after?btn('检查修改事件 '+x.seq,()=>jumpToEvent(x.eventId)):h('p',null,'此事件已删除，请检查修改对比或撤销。'))),
              ...diagnosis.setupChanges.map((x,i)=>h('p',{key:i},(players[x.seat]?.name??'开局')+'的起手、换牌或开局设置已修改。',btn('检查开局设置',()=>setTab('players')))),
              ...diagnosis.handDifferences.map(x=>h('div',{key:x.seat},h('strong',null,(players[x.seat]?.name??'玩家')+' · 出错动作执行前的暗手差异'),
                h('p',null,[x.more.length?'多 '+countTiles(x.more):'',x.less.length?'少 '+countTiles(x.less):''].filter(Boolean).join('；')),
                h('details',null,h('summary',null,'查看修改前后手牌'),h('p',null,'修改前：'+x.beforeHand.map(editTileName).join('、')),h('p',null,'当前草稿：'+x.draftHand.map(editTileName).join('、'))))),
              !diagnosis.handDifferences.length?h('p',null,'没有可展示的暗手差异；请根据具体错误检查动作、来源或开局设置。'):null,
              diagnosis.suspectedEvents.length?h('div',null,h('h3',null,'建议检查关联步骤'),h('div',{className:'dsh-edit-row'},...diagnosis.suspectedEvents.map(x=>btn('检查事件 '+x.seq+' · '+editActions[x.action]+editTileName(x.tile),()=>jumpToEvent(x.eventId))))):null,
              h('p',{className:'dsh-edit-muted'},diagnosis.notice)):null):null,
          validation?.warnings?.length?h('div',{className:'dsh-edit-muted'},...validation.warnings.map((w,i)=>h('p',{key:i},w))):null,
          input('本次修正说明',reason,setReason)),
        h('footer',null,h('p',{role:'status','aria-live':'polite'},status),retry?btn('重试加载',()=>run(async()=>{await currentFrame();setRetry(false);setStatus('已更新回放；视频核对未完成。');})):null,h('div',{className:'dsh-edit-row'},btn('保存草稿',()=>run(async()=>{await persistDraft();setStatus('草稿已保存。正式回放未改变。');})),btn('校验并预览',()=>run(()=>preview())),btn('保存并更新回放',()=>run(commit),!validation?.ok,true))));
    }

    function SourceReplayControls(props){
      var game=props.state.game,source=game.sourceReplay,client=props.client;
      var [editing,setEditing]=react.useState(false);
      var play=react.useState(false),playing=play[0],setPlaying=play[1];
      var speed=react.useState(1000),interval=speed[0],setIntervalMs=speed[1];
      var following=source.viewMode==="follow";
      react.useEffect(()=>{setPlaying(false);},[props.sessionId]);
      react.useEffect(()=>{
        if(!playing||editing||client.sourceLoading)return;
        if(game.historyIndex>=game.historyCount-1||client.formError){setPlaying(false);return;}
        var timer=setTimeout(()=>props.controller.stepSource(props.sessionId,game.historyIndex+1,source.seat),interval);
        return()=>clearTimeout(timer);
      },[playing,editing,game.historyIndex,client.sourceLoading,client.formError,source.seat,source.viewMode,props.sessionId,interval]);
      var step=(i,seat=source.seat,lesson=null,viewMode)=>{if(editing)return;setPlaying(false);return props.controller.stepSource(props.sessionId,i,seat,lesson,viewMode);};
      var lecture=source.lesson===null?null:source.lessons[source.lesson];
      var button=(text,fn,disabled=false)=>react.createElement("button",{className:"dsh-mj-mode-button",disabled:disabled||editing,onClick:fn},text);
      return react.createElement("div",{"data-dsh-source-controls":true,style:{display:"flex",flexDirection:"column",gap:5,maxWidth:"100%",fontSize:12}},
        react.createElement("div",{style:{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}},
          button("赛事案例",()=>{setPlaying(false);props.controller.openSources();}),
          source.editable?button("纠正牌谱",()=>{setPlaying(false);setEditing(true);}):null,
          button("上一步",()=>step(game.historyIndex-1),client.sourceLoading||game.historyIndex===0),
          button(playing?"暂停":"播放",()=>setPlaying(!playing),game.historyIndex===game.historyCount-1),
          button("下一步",()=>step(game.historyIndex+1),client.sourceLoading||game.historyIndex+1===game.historyCount),
          react.createElement("select",{"aria-label":"回放步骤",disabled:editing,value:game.historyIndex,onChange:e=>{var index=Number(e.target.value),keep=source.lesson!==null&&(source.lessons[source.lesson].sequence??[source.lessons[source.lesson].step]).includes(index);step(index,source.seat,keep?source.lesson:null);},style:{maxWidth:220}},source.items.map(item=>react.createElement("option",{key:item.index,value:item.index},(item.index+1)+" / "+game.historyCount+" · "+item.label))),
          react.createElement("select",{"aria-label":"观察模式",disabled:editing||client.sourceLoading,value:source.viewMode??"fixed",onChange:e=>step(game.historyIndex,source.seat,source.lesson,e.target.value),title:"跟随每一步的行动玩家；弃牌后仍停留在出牌者视角"},
            react.createElement("option",{value:"fixed"},"固定玩家"),react.createElement("option",{value:"follow",disabled:source.followAvailable===false},"跟随行动玩家")),
          react.createElement("select",{"aria-label":"观察选手",disabled:editing||client.sourceLoading||following,value:source.seat,onChange:e=>step(game.historyIndex,Number(e.target.value),source.lesson)},source.players.map(p=>react.createElement("option",{key:p.seat,value:p.seat},p.name))),
          react.createElement("select",{"aria-label":"播放间隔",value:interval,onChange:e=>setIntervalMs(Number(e.target.value))},[500,1000,2000].map(ms=>react.createElement("option",{key:ms,value:ms},ms/1000+"秒/步"))),
          button("关键步",()=>step(source.keyIndex,source.keySeat)),
          react.createElement("select",{"aria-label":"讲解章节",disabled:editing,value:source.lesson??-1,onChange:e=>{var n=Number(e.target.value);step(n<0?game.historyIndex:source.lessons[n].step,n<0?source.seat:source.keySeat,n<0?null:n);},style:{maxWidth:235}},
            react.createElement("option",{value:-1},"关键步讲解…"),source.lessons.map((l,i)=>react.createElement("option",{key:i,value:i},(i+1)+". "+l.title))),
          react.createElement("span",null,"录像约 "+Math.floor(source.items[game.historyIndex].at/60)+":"+(source.items[game.historyIndex].at%60).toFixed(1).padStart(4,"0"))),
        lecture?react.createElement("div",{"data-dsh-source-lesson":true,style:{padding:"4px 0",maxWidth:1150,lineHeight:"20px"}},react.createElement("strong",{style:{fontSize:15}},lecture.title+" · "),lecture.lines.join("；"),lecture.hypothesis?react.createElement("strong",{style:{color:"#a14a16"}},"【假设选择，非原选手实打】"):null):null,
        react.createElement("div",{"data-dsh-source-question":true,style:{fontSize:11,color:"var(--color-text-secondary,#666)"}},
          (source.questionHash!==source.sourceHash?"下方旧问答仍绑定修改前版本；点击提问这一步使用新版。 · ":"")+"下方问答固定："+source.players[source.questionSeat].name+" · 第 "+(source.questionIndex+1)+" 个时点。切换后点击“提问这一步”建立对应问答。 · "+source.notice,
          client.formError?react.createElement("span",{role:"alert"},client.formError):null),
        editing?react.createElement(SourceCorrectionEditor,{controller:props.controller,sessionId:props.sessionId,game,onClose:()=>setEditing(false)}):null);
    }

    function LibraryDialog(props) {
      var client=useController(props.controller);
      var workspaces=props.useWorkspaces((value)=>value);
      var sessions=props.useSessions((value)=>value);
      var dialogRef=react.useRef(null);
      var fileRef=react.useRef(null);
      var usersState=react.useState(null), users=usersState[0],setUsers=usersState[1];
      var nameState=react.useState(""),name=nameState[0],setName=nameState[1];
      var shareState=react.useState(null),shares=shareState[0],setShares=shareState[1];
      var importErrorState=react.useState(null),importError=importErrorState[0],setImportError=importErrorState[1];
      var quotaState=react.useState({}),quotas=quotaState[0],setQuotas=quotaState[1];
      var inviteState=react.useState(null),invite=inviteState[0],setInvite=inviteState[1];
      if(!client.libraryOpen)return null;
      var act=(op,input)=>props.controller.replayAction(op,input).catch(()=>null);
      var manage=async(command)=>{var result=await act("users",command?{command}:{});if(result?.invitation)setInvite(result.invitation);var list=await act("users",{});if(list)setUsers(list.users);};
      return react.createElement("div",{className:"dsh-mj-dialog-layer",onMouseDown:e=>{if(e.target===e.currentTarget)props.controller.closeLibrary();}},
        react.createElement("div",{className:"dsh-mj-dialog",role:"dialog","aria-modal":"true","aria-label":"我的牌谱",ref:dialogRef,onKeyDown:e=>{if(e.key==="Escape")props.controller.closeLibrary();else trapDialogFocus(e,dialogRef.current);}},
          react.createElement("header",{className:"dsh-mj-dialog-header"},react.createElement("h2",{className:"dsh-mj-dialog-title"},"我的牌谱"),
            react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>props.controller.closeLibrary()},"关闭")),
          react.createElement("div",{className:"dsh-mj-form"},
            react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>props.controller.openSources()},"赛事案例 · 完整回放与讲解"),
            react.createElement("p",null,"逐步复盘与问答。完整记录可以导出和分享；可重建的历史局面可以另开练习。"),
            react.createElement("input",{ref:fileRef,type:"file",accept:".json,application/json",style:{display:"none"},onChange:async e=>{
              var file=e.target.files?.[0];if(!file)return;
              setImportError(null);
              if(file.size>24*1024*1024){setImportError("牌谱文件不能超过 24 MB。");e.target.value="";return;}
              try{await props.controller.replayAction("import",{archive:JSON.parse(await file.text())});}catch(error){setImportError(error instanceof SyntaxError?"文件不是有效的 JSON 牌谱，请选择本应用导出的文件。":error.message);} e.target.value="";
            }}),
            react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>fileRef.current?.click()},"导入牌谱")," ",
            react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>props.controller.openLibrary()},"刷新"),
            importError?react.createElement("p",{role:"alert",className:"dsh-mj-error"},importError):null,
            client.libraryStatus==="loading"?react.createElement("p",{role:"status"},"正在读取牌谱…"):null,
            client.libraryStatus==="ready"&&!client.library.length?react.createElement("p",null,"还没有牌谱，开一桌后会自动记录。"):null,
            client.library.map(item=>react.createElement("div",{key:item.gameId,style:{borderBottom:"1px solid var(--border-color,#333)",padding:"14px 0",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}},
              react.createElement("div",{style:{flex:"1 1 240px"}},react.createElement("strong",null,item.tableName),
                react.createElement("div",{style:{fontSize:12,opacity:.7}},(item.ruleset==="guobiao"?"标准国标":"血战到底")+" · "+(item.mode==="practice"?"练习 · ":"")+(item.phase==="done"?"已结束":item.imported?"已导入":"进行中")+" · "+new Date(item.createdAt).toLocaleString())),
              react.createElement("button",{className:"dsh-mj-secondary",disabled:client.formStatus==="starting",onClick:()=>props.controller.openHistory(item.gameId,undefined,resolveWorkspaceId(workspaces,sessions.current))},"复盘"),
              react.createElement("button",{className:"dsh-mj-secondary",disabled:item.phase!=="done"&&!item.imported,onClick:()=>act("export",{gameId:item.gameId})},"导出"),
              react.createElement("button",{className:"dsh-mj-secondary",disabled:item.phase!=="done"&&!item.imported,onClick:async()=>{await act("share",{gameId:item.gameId});setShares(await act("shares",{gameId:item.gameId}));}},"分享"),
              react.createElement("button",{className:"dsh-mj-secondary",onClick:async()=>setShares(await act("shares",{gameId:item.gameId}))},"管理分享"))),
            shares?react.createElement("div",{style:{marginTop:12}},react.createElement("strong",null,"此牌谱的有效分享"),!shares.items.length?react.createElement("p",null,"没有有效分享链接。"):null,shares.items.map(item=>react.createElement("div",{key:item.shareId},react.createElement("input",{className:"dsh-mj-input",readOnly:true,value:item.url,onFocus:e=>e.currentTarget.select()}),react.createElement("span",null,"有效至 "+new Date(item.expiresAt).toLocaleString()),react.createElement("button",{className:"dsh-mj-secondary",onClick:async()=>{await act("revokeShare",{gameId:shares.gameId,shareId:item.shareId});setShares(await act("shares",{gameId:shares.gameId}));}},"撤销分享")))):null,
            client.shareResult?react.createElement("div",{style:{marginTop:12}},react.createElement("label",null,"分享链接（7 天有效）",react.createElement("input",{className:"dsh-mj-input",readOnly:true,value:client.shareResult.url,onFocus:e=>e.currentTarget.select()})),
              react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>act("revokeShare",{gameId:client.shareResult.gameId,shareId:client.shareResult.shareId})},"撤销此分享")):null,
            react.createElement("details",{style:{marginTop:20}},react.createElement("summary",null,"服务使用者管理"),
              react.createElement("p",null,"管理员可以邀请使用者、设置配额和撤销权限。统一部署与自行部署使用相同功能。"),
              react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>manage()},"读取使用者"),
              react.createElement("input",{className:"dsh-mj-input",value:name,placeholder:"使用者标识（英文或数字）",onChange:e=>setName(e.target.value)}),
              react.createElement("button",{className:"dsh-mj-secondary",disabled:!name,onClick:()=>manage({operation:"invite",owner:name})},"生成一次性邀请"),
              invite?react.createElement("label",null,"将此邀请交给使用者，在本地安装助手中领取",react.createElement("input",{className:"dsh-mj-input",readOnly:true,value:invite,onFocus:e=>e.currentTarget.select()})):null,
              users?.map(user=>react.createElement("div",{key:user.owner,style:{display:"flex",alignItems:"center",gap:8,marginTop:8}},
                react.createElement("span",{style:{flex:1}},user.owner+" · "+(user.active?"可用":"已撤销")+" · 最多 "+user.maxActive+" 桌 / "+user.maxTables+" 份记录"),
                ...["maxActive","maxTables"].map(key=>react.createElement("label",{key},key==="maxActive"?"同时牌桌":"保留记录",react.createElement("input",{type:"number",min:1,max:500,style:{width:64},value:quotas[user.owner]?.[key]??user[key],onChange:e=>setQuotas({...quotas,[user.owner]:{...quotas[user.owner],[key]:Number(e.target.value)}})}))),
                react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>manage({operation:"quota",owner:user.owner,...quotas[user.owner]})},"保存配额"),
                react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>manage({operation:user.active?"revoke":"invite",owner:user.owner})},user.active?"撤销权限":"重新邀请")))),
            client.formError?react.createElement("p",{role:"alert",className:"dsh-mj-error"},client.formError):null)));
    }

    function LessonsDialog(props){
      var client=useController(props.controller);
      var workspaces=props.useWorkspaces(v=>v),sessions=props.useSessions(v=>v);
      var ref=react.useRef(null);
      if(!client.lessonsOpen)return null;
      return react.createElement("div",{className:"dsh-mj-dialog-layer"},react.createElement("div",{className:"dsh-mj-dialog",role:"dialog","aria-modal":"true","aria-label":"教练课程",ref,onKeyDown:e=>{if(e.key==="Escape")props.controller.closeLessons();else trapDialogFocus(e,ref.current);}},
        react.createElement("header",{className:"dsh-mj-dialog-header"},react.createElement("h2",{className:"dsh-mj-dialog-title"},"教练课程"),react.createElement("button",{className:"dsh-mj-secondary",onClick:()=>props.controller.closeLessons()},"关闭")),
        react.createElement("div",{className:"dsh-mj-form"},react.createElement("p",null,"四个单步基础关卡，使用真实牌桌和血战规则。学习进度独立于实战成绩。每次操作限时 120 秒。"),
          client.lessons.map(lesson=>react.createElement("div",{key:lesson.id,style:{padding:"16px 0",borderBottom:"1px solid var(--border-color,#333)"}},
            react.createElement("strong",null,lesson.title),react.createElement("p",null,lesson.goal),
            react.createElement("span",null,(lesson.progress.passed?"已通过":"尚未通过")+" · 已练 "+lesson.progress.attempts+" 次 "),
            react.createElement("button",{className:"dsh-mj-primary",disabled:client.formStatus==="starting",onClick:()=>props.controller.startLesson(lesson.id,resolveWorkspaceId(workspaces,sessions.current))},"开始练习"))),
          client.formError?react.createElement("p",{role:"alert",className:"dsh-mj-error"},client.formError):null)));
    }
    function FloatingMahjongSurface(props) {
      react.useLayoutEffect(() => installStyles(), []);
      return react.createElement(
        "div",
        { className: "dsh-mj-overlay", "data-dsh-mahjong-overlay": "m0", "data-mode": useOverlayMode() },
        react.createElement(MahjongTable, props),
        react.createElement(SetupDialog, props),
        react.createElement(InviteDialog, props),
        react.createElement(LibraryDialog, props),
        react.createElement(LessonsDialog, props),
        react.createElement(SourcesDialog, props),
      );
    }

    function SidebarMahjongEntry(props) {
      var client = useController(props.controller);
      react.useLayoutEffect(() => installStyles(), []);
      react.useEffect(() => {
        if (client.lastSessionId) props.controller.loadSession(client.lastSessionId, false);
      }, [client.lastSessionId]);
      var activeState = client.lastSessionId && client.statesBySession[client.lastSessionId];
      var active = Boolean(activeState && activeState.phase === "active" && activeState.game);
      return react.createElement(
        "button",
        {
          type: "button",
          className: "dsh-mj-sidebar-entry",
          "data-dsh-mahjong-launch": "true",
          "data-wide": String(props.wide),
          title: props.wide ? undefined : "麻将实验室",
          "aria-label": "打开麻将实验室",
          "aria-haspopup": "dialog",
          onClick: () => props.controller.openEntry(),
        },
        react.createElement("span", { className: "dsh-mj-brand-logo", title: "MJLab.ai", "aria-hidden": "true" }, react.createElement("img", { src: MJLAB_LOGO, alt: "", width: 34, height: 34, draggable: false })),
        props.wide ? react.createElement("span", { className: "dsh-mj-sidebar-label" }, "麻将实验室") : null,
        props.wide && active ? react.createElement("span", { className: "dsh-mj-sidebar-dot", title: "牌局进行中", "aria-label": "牌局进行中" }) : null,
      );
    }

    function focusNativeComposer() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        var input = document.querySelector("[data-composer-seat] textarea, [data-composer-seat] [contenteditable=\"true\"]");
        if (input && typeof input.focus === "function") input.focus();
      }));
    }

    function MahjongModeUtility(props) {
      var mode = useOverlayMode();
      var compact = mode === "compact";
      var client = useController(props.controller);
      var state = client.statesBySession[props.sessionId];
      react.useEffect(() => {
        if (props.sessionId) props.controller.loadSession(props.sessionId, false);
      }, [props.sessionId]);
      if (!state || state.phase !== "active" || !state.game) return null;
      function onClick() {
        if(state?.game?.mode === "source-replay" && !compact){props.controller.askSource(props.sessionId);return;}
        if (compact) setOverlayMode("large");
        else { setOverlayMode("compact"); focusNativeComposer(); }
      }
      return react.createElement(
        "button",
        { type: "button", className: "dsh-mj-mode-button", "data-dsh-mahjong-toggle": "true", "aria-pressed": compact, "aria-label": compact ? "聚焦牌桌" : "提问这一步", onClick },
        compact ? "聚焦牌桌" : "提问这一步",
      );
    }

    function MahjongInviteUtility(props) {
      var client = useController(props.controller);
      var state = client.statesBySession[props.sessionId];
      react.useEffect(() => {
        if (props.sessionId) props.controller.loadSession(props.sessionId, false);
      }, [props.sessionId]);
      var invitations = state && state.phase === "active" && state.game && Array.isArray(state.game.seatInvites)
        ? state.game.seatInvites
        : [];
      if (invitations.length === 0) return null;
      return react.createElement(
        "button",
        { type: "button", className: "dsh-mj-mode-button", "data-dsh-mahjong-invite-action": "true", "aria-haspopup": "dialog", "aria-label": "邀请真人入座", onClick: () => props.controller.openInvites(props.sessionId) },
        "邀请真人 · " + invitations.length,
      );
    }

    function MahjongCaseUtility(props) {
      var client = useController(props.controller);
      var state = client.statesBySession[props.sessionId];
      var workspaces = props.useWorkspaces((value) => value);
      var coaching=client.coachStatuses?.[props.sessionId];
      react.useEffect(()=>{
        if(!props.sessionId || !["live","practice"].includes(state?.game?.mode))return;
        var timer=setInterval(()=>props.controller.loadSession(props.sessionId,true),4000);
        return()=>clearInterval(timer);
      },[props.sessionId,state?.game?.mode]);
      var modelError=state?.game?.runtime?.modelErrorCode;
      var modelNotice=modelError==="MODEL_QUOTA"?"模型余额不足，牌桌将按超时规则托管。请在模型服务商账户中处理。"
        :modelError==="MODEL_AUTH"?"模型凭据不可用，请检查本地 Harness 模型设置。牌桌将按超时规则托管。"
        :modelError?"模型暂时不可用，牌桌将按超时规则托管。":null;
      var hintPair=react.useState(false),showHint=hintPair[0],setHint=hintPair[1];
      react.useEffect(()=>{
        if(state?.game?.mode!=="coach")return;
        props.controller.readCoachStatus(props.sessionId);
        if(coaching?.coach?.status && coaching.coach.status!=="active")return;
        var timer=setInterval(()=>props.controller.readCoachStatus(props.sessionId),2000);return()=>clearInterval(timer);
      },[props.sessionId,state?.game?.mode,coaching?.coach?.status]);
      if(state?.game?.mode==="coach")return react.createElement("div",{style:{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}},
        react.createElement("span",{title:coaching?.lesson?.goal},coaching?.lesson?.title??"基础教学"),
        react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>setHint(!showHint)},showHint?"收起提示":"查看提示"),
        showHint?react.createElement("span",{style:{maxWidth:380,fontSize:12}},coaching?.lesson?.hint):null,
        coaching?.coach?.status!=="active"?react.createElement("span",{role:"status",style:{maxWidth:380,fontSize:12}},coaching?.coach?.feedback):null,
        react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>props.controller.openLessons()},"课程与进度"),
        react.createElement("button",{className:"dsh-mj-mode-button",disabled:client.formStatus==="starting",onClick:()=>props.controller.startLesson(state.game.coach.lessonId,resolveWorkspaceId(workspaces,props.sessionId))},"再练一次"));
      if(state?.game?.mode === "source-replay")return react.createElement(SourceReplayControls,{...props,state,client});
      if(state?.game?.mode === "replay")return react.createElement("div",{style:{display:"flex",gap:6,alignItems:"center"}},
        react.createElement("button",{className:"dsh-mj-mode-button",disabled:client.formStatus==="starting"||state.game.historyIndex<=(state.game.historyFirst??0),onClick:()=>props.controller.openHistory(state.game.gameId,state.game.historyIndex-1,resolveWorkspaceId(workspaces,props.sessionId))},"上一步"),
        react.createElement("span",null,"步骤 "+state.game.historyIndex+" / "+(state.game.historyCount-1)),
        react.createElement("button",{className:"dsh-mj-mode-button",disabled:client.formStatus==="starting"||state.game.historyIndex+1>=state.game.historyCount,onClick:()=>props.controller.openHistory(state.game.gameId,state.game.historyIndex+1,resolveWorkspaceId(workspaces,props.sessionId))},"下一步"),
        react.createElement("button",{className:"dsh-mj-mode-button",disabled:!state.game.canPractice,onClick:()=>props.controller.beginPractice(props.sessionId)},"从这里练习"),
        react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>props.controller.openLibrary()},"我的牌谱"),
        client.formError?react.createElement("span",{role:"alert"},client.formError):null);
      if (!state || state.game?.mode !== "case") return react.createElement("div", null, react.createElement("button", {
        type: "button", className: "dsh-mj-mode-button", disabled: client.formStatus === "starting",
        onClick: () => props.controller.openSources(),
      }, "赛事案例"),modelNotice?react.createElement("span",{role:"status",style:{fontSize:12,color:"var(--color-text-warning, #a65d00)"}},modelNotice):null,react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>props.controller.openLibrary()},"我的牌谱"),
        react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>props.controller.openLessons()},"教练课程"),
        react.createElement("button",{className:"dsh-mj-mode-button",onClick:()=>props.controller.newTable()},"开新桌"), client.formError ? react.createElement("span", { role: "alert" }, client.formError) : null);
      return react.createElement("div", { style: { display: "flex", gap: 4 }, "aria-label": "案例步骤（每步独立问答）" },
        ["摸牌前", "摸入三条", "自摸后记分"].map((label, eventIndex) => react.createElement("button", {
          key: eventIndex, type: "button", className: "dsh-mj-mode-button",
          "aria-pressed": eventIndex === state.game.caseFrame.eventIndex,
          disabled: client.formStatus === "starting",
          onClick: () => props.controller.openCase(eventIndex, resolveWorkspaceId(workspaces, props.sessionId)),
        }, label)),
        client.formError ? react.createElement("span", { role: "alert" }, client.formError) : null);
    }

    function apply(ctx) {
      var controller = createMahjongController(ctx);
      var injected = () => ({ controller });
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
        { name: "sidebar.footer.action", id: "dsh-mahjong-entry", order: 40, label: "麻将实验室", inject: injected },
        SidebarMahjongEntry,
      ));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "dsh-mahjong-hand", order: 100, inject: injected },
        FloatingMahjongSurface,
      ));
      ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
        { name: "conversation.session.header.utilities", id: "dsh-mahjong-toggle", order: 80, label: "牌桌显示", inject: injected },
        MahjongModeUtility,
      ));
      ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
        { name: "conversation.session.header.utilities", id: "dsh-mahjong-case", order: 78, label: "案例步骤", inject: injected },
        MahjongCaseUtility,
      ));
      ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
        { name: "conversation.session.header.utilities", id: "dsh-mahjong-invites", order: 79, label: "邀请真人", inject: injected },
        MahjongInviteUtility,
      ));
    }

    exports.name = "dsh-mahjong";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
