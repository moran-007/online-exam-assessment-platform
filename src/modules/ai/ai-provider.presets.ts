export type AiProviderPreset = {
  provider: string;
  name: string;
  baseUrl: string;
  model: string;
  documentationUrl: string;
  note: string;
};

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    provider: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    documentationUrl: 'https://api-docs.deepseek.com/', note: 'DeepSeek 官方 OpenAI 兼容端点',
  },
  {
    provider: 'qwen', name: '阿里云百炼 / 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-plus',
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/base-url', note: '北京地域，API Key 必须与地域匹配',
  },
  {
    provider: 'doubao', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260215',
    documentationUrl: 'https://www.volcengine.com/docs/82379/1795150', note: '模型可替换为控制台推理接入点 ID',
  },
  {
    provider: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.1',
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction', note: '通用 API，不使用 Coding 套餐专属端点',
  },
  {
    provider: 'kimi', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6',
    documentationUrl: 'https://platform.kimi.com/docs/api/quickstart', note: '中国区 Kimi API 端点',
  },
  {
    provider: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7',
    documentationUrl: 'https://platform.minimaxi.com/docs/api-reference/text-chat-openai', note: 'MiniMax OpenAI 兼容文本对话',
  },
  {
    provider: 'qianfan', name: '百度智能云千帆', baseUrl: 'https://qianfan.baidubce.com/v2', model: 'deepseek-v3.1-250821',
    documentationUrl: 'https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb', note: '千帆 V2 OpenAI 兼容推理服务',
  },
  {
    provider: 'hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest',
    documentationUrl: 'https://cloud.tencent.com/document/product/1729/111007', note: '腾讯混元 OpenAI 兼容端点',
  },
  {
    provider: 'openrouter-hunyuan', name: 'OpenRouter / 腾讯混元 Hy3', baseUrl: 'https://openrouter.ai/api/v1', model: 'tencent/hy3',
    documentationUrl: 'https://openrouter.ai/tencent/hy3', note: '适用于 OpenRouter 路由 Key，与腾讯云官方 Key 不通用',
  },
] as const;
