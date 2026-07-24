export type AiProviderPreset = {
  provider: string;
  name: string;
  baseUrl: string;
  model: string;
  models: readonly string[];
  documentationUrl: string;
  note: string;
};

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    provider: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    documentationUrl: 'https://api-docs.deepseek.com/', note: 'DeepSeek 官方 OpenAI 兼容端点',
  },
  {
    provider: 'qwen', name: '阿里云百炼 / 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus',
    models: ['qwen3.7-plus', 'qwen3.5-plus', 'qwen3-coder-next', 'qwen3-coder-plus'],
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/base-url', note: '北京地域，API Key 必须与地域匹配',
  },
  {
    provider: 'doubao', name: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260215',
    models: ['doubao-seed-2-0-lite-260215'],
    documentationUrl: 'https://www.volcengine.com/docs/82379/1795150', note: '模型可替换为控制台推理接入点 ID',
  },
  {
    provider: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.1',
    models: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flashx'],
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction', note: '通用 API，不使用 Coding 套餐专属端点',
  },
  {
    provider: 'kimi', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    documentationUrl: 'https://platform.kimi.com/docs/api/quickstart', note: '中国区 Kimi API 端点',
  },
  {
    provider: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2'],
    documentationUrl: 'https://platform.minimaxi.com/docs/api-reference/text-chat-openai', note: 'MiniMax OpenAI 兼容文本对话',
  },
  {
    provider: 'qianfan', name: '百度智能云千帆', baseUrl: 'https://qianfan.baidubce.com/v2', model: 'deepseek-v3.1-250821',
    models: ['deepseek-v4-flash', 'deepseek-v3.2-think', 'deepseek-v3.1-250821', 'deepseek-v3.1-think-250821', 'deepseek-v3'],
    documentationUrl: 'https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb', note: '千帆 V2 OpenAI 兼容推理服务',
  },
  {
    provider: 'hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest',
    models: ['hunyuan-turbos-latest', 'hunyuan-a13b'],
    documentationUrl: 'https://cloud.tencent.com/document/product/1729/111007', note: '腾讯混元 OpenAI 兼容端点',
  },
  {
    provider: 'openrouter-hunyuan', name: 'OpenRouter / 腾讯混元 Hy3', baseUrl: 'https://openrouter.ai/api/v1', model: 'tencent/hy3',
    models: ['tencent/hy3'],
    documentationUrl: 'https://openrouter.ai/tencent/hy3', note: '适用于 OpenRouter 路由 Key，与腾讯云官方 Key 不通用',
  },
] as const;
