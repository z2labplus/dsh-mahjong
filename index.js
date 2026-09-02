const objectOutput = {
  schema: {
    type: "object",
    additionalProperties: true,
  },
  render: (_args, value) => [
    {
      type: "text",
      text: JSON.stringify(value),
    },
  ],
};

const m0StatusTool = {
  name: "dsh_mahjong_m0_status",
  description: "返回 dsh-mahjong 当前 M0 集成状态。",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  output: objectOutput,
  execute() {
    return {
      product: "dsh-mahjong",
      stage: "M0",
      harness: "0.1.0-rc.8",
      layout: "game-main-with-assistant-sidecar",
      handReuse: "iframe-original",
      handDesignSize: {
        width: 1280,
        height: 720,
        scaling: "contain",
      },
      actionTimeoutSeconds: 38,
      serverDecisionBridge: "not-connected",
    };
  },
};

export const name = "dsh-mahjong";
export const inject = ["tools"];

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(m0StatusTool));
}
