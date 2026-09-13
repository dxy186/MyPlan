/**
 * MyPlan · AI 智能体层的统一出口
 *
 * 目前接入 DeepSeek（与原有 app/ai.tsx 行为完全一致）。
 * Key 只有一份：沿用原页面里的常量，本文件不再重复硬编码。
 * 如果以后换 Key / 换模型，用 saveAiConfig() 写入本地配置即可覆盖默认值。
 */

import { KEYS, loadJSON, saveJSON } from './planning';

export type AiConfig = {
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_CONFIG: AiConfig = {
  provider: 'deepseek',
  // Key 不写死在代码里：默认读本地 .env（开发用，.env 不会提交）；
  // 每个人也可以在 App 里自己填，填了存在本地并覆盖这里的默认值。
  apiKey: process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY ?? '',
  apiUrl: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
};

export async function getAiConfig(): Promise<AiConfig> {
  const saved = await loadJSON<Partial<AiConfig>>(KEYS.aiConfig, {});
  return { ...DEFAULT_CONFIG, ...saved };
}

export async function saveAiConfig(patch: Partial<AiConfig>): Promise<void> {
  // 只落盘用户显式改过的字段，避免把默认 Key 复制进本地存储
  const saved = await loadJSON<Partial<AiConfig>>(KEYS.aiConfig, {});
  await saveJSON(KEYS.aiConfig, { ...saved, ...patch });
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function callChat(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const cfg = await getAiConfig();
  const response = await fetch(cfg.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `请求失败 (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '抱歉，我没有给出回复。';
}

/** 让模型输出 JSON，并容错地解析（去掉 ```json 包裹） */
export async function callChatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const text = await callChat(messages, { temperature: 0.3, maxTokens: 4000 });
  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const json = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(json) as T;
}
