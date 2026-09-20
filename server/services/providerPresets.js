/**
 * Common OpenAI-compatible API presets.  A preset provides safe defaults for
 * the endpoint and model; users only need to supply their own API key.
 * `supportsVision` deliberately describes the API/model default, not an
 * account entitlement, so the connection test still performs a real image
 * request before a provider is used for photo analysis.
 */
export const PROVIDER_PRESETS = {
  openai: {
    id: 'openai', name: 'OpenAI',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini',
    supportsVision: true
  },
  qwen: {
    id: 'qwen', name: '通义千问（DashScope）',
    apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-max-latest',
    supportsVision: true
  },
  zhipu: {
    id: 'zhipu', name: '智谱 AI',
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-plus',
    supportsVision: true
  },
  siliconflow: {
    id: 'siliconflow', name: '硅基流动',
    apiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    supportsVision: true
  },
  openrouter: {
    id: 'openrouter', name: 'OpenRouter',
    apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'google/gemini-2.5-flash',
    supportsVision: true
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek',
    apiEndpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    supportsVision: true,
    note: 'deepseek-flash 支持 OpenAI 兼容的图片输入。'
  },
  mimo: {
    id: 'mimo', name: '小米 MiMo',
    apiEndpoint: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-pro',
    supportsVision: 'model-dependent',
    note: '是否支持图片取决于已开通的模型；请先运行图片能力测试。'
  },
  custom: { id: 'custom', name: '自定义 OpenAI 兼容接口', apiEndpoint: '', model: '', supportsVision: 'unknown' }
};

export const getProviderPreset = (presetId) => PROVIDER_PRESETS[presetId] || null;

export const applyProviderPreset = (provider = {}) => {
  const inferredPreset = Object.values(PROVIDER_PRESETS).find(candidate =>
    candidate.id !== 'custom' && candidate.apiEndpoint === (provider.apiEndpoint || provider.endpoint)
  );
  const preset = getProviderPreset(provider.preset) || inferredPreset;
  return {
    ...provider,
    preset: preset?.id || 'custom',
    name: provider.name || preset?.name || '自定义 OpenAI 兼容接口',
    apiEndpoint: provider.apiEndpoint || provider.endpoint || preset?.apiEndpoint || '',
    model: provider.model || preset?.model || 'multimodal-large'
  };
};
