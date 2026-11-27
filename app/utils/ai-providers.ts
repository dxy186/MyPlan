/**
 * 能接的 AI 服务商：都走「OpenAI 兼容」的 /chat/completions 接口。
 * 默认模型只是起点：设置里可以改，也可以点「获取模型列表」从服务商那里挑。
 */
export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'kimi'
  | 'zhipu'
  | 'qwen'
  | 'siliconflow'
  | 'openrouter'
  | 'gemini'
  | 'anthropic'
  | 'ollama'
  | 'custom';

export type Provider = {
  id: ProviderId;
  name: string;
  apiUrl: string;
  model: string;
  visionModel: string;
  /** 去哪里申请 Key */
  keyUrl?: string;
  keyHint?: string;
  /** 不需要 Key（本机模型） */
  noKey?: boolean;
  note?: string;
  /** 额外的请求头 */
  headers?: Record<string, string>;
};

export const PROVIDERS: Provider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    visionModel: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com',
    keyHint: 'sk-...',
    note: '便宜、中文好，现在默认用的就是它。',
  },
  {
    id: 'openai',
    name: 'OpenAI（GPT）',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    note: '国内网络一般连不上。',
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    visionModel: 'moonshot-v1-8k-vision-preview',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk-...',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    visionModel: 'glm-4v-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: 'glm-4-flash / glm-4v-flash 是免费模型。',
  },
  {
    id: 'qwen',
    name: '通义千问（阿里百炼）',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-plus',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    keyHint: 'sk-...',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'deepseek-ai/DeepSeek-V3',
    visionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: 'sk-...',
    note: '一个 Key 能用很多开源模型。',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-4o-mini',
    visionModel: 'openai/gpt-4o-mini',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    note: '一个 Key 能用 GPT、Claude、Gemini 等；模型名写成「厂商/模型」，比如 anthropic/claude-…、google/gemini-…。',
    headers: { 'X-Title': 'MyPlan' },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.0-flash',
    visionModel: 'gemini-2.0-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: '国内网络一般连不上。',
  },
  {
    id: 'anthropic',
    name: 'Claude（Anthropic）',
    apiUrl: 'https://api.anthropic.com/v1/chat/completions',
    model: 'claude-haiku-5-5',
    visionModel: 'claude-haiku-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    note: '用的是 Anthropic 的 OpenAI 兼容接口；网页版可能被浏览器拦下，桌面版更稳。连不上的话可以改用 OpenRouter。',
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  },
  {
    id: 'ollama',
    name: 'Ollama（本机模型）',
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b',
    visionModel: 'llava',
    noKey: true,
    note: '模型跑在你自己电脑上，免费、不联网。要先装 Ollama 并下载模型（ollama pull qwen2.5:7b）。网页版要在 Ollama 里允许跨域（OLLAMA_ORIGINS=*），桌面版不用。小模型可能不太会按格式回复。',
  },
  {
    id: 'custom',
    name: '自定义',
    apiUrl: '',
    model: '',
    visionModel: '',
    note: '任何 OpenAI 兼容的接口都行：填完整地址（一般以 /v1/chat/completions 结尾）、Key 和模型名。',
  },
];

export function providerOf(id: string | undefined): Provider {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0];
}

/** /v1/chat/completions → /v1/models */
export function modelsUrlOf(apiUrl: string): string {
  return apiUrl.replace(/\/chat\/completions\/?$/, '/models');
}
