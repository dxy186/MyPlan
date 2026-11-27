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
  /** 看图用的模型（要支持图片输入）；DeepSeek 是 deepseek-flash */
  visionModel?: string;
};

const DEFAULT_CONFIG: AiConfig = {
  provider: 'deepseek',
  // Key 不写死在代码里：默认读本地 .env（开发用，.env 不会提交）；
  // 每个人也可以在 App 里自己填，填了存在本地并覆盖这里的默认值。
  apiKey: process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY ?? '',
  apiUrl: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  visionModel: 'deepseek-flash',
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

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

export async function callChat(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; model?: string; extra?: Record<string, unknown> }
): Promise<string> {
  const cfg = await getAiConfig();
  const response = await fetch(cfg.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: opts?.model || cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4000,
      ...(opts?.extra ?? {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `请求失败 (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '抱歉，我没有给出回复。';
}

/** 模型没按 JSON 回复时抛出，raw 是它的原文（调用方可以当普通回复显示） */
export class AiFormatError extends Error {
  raw: string;
  constructor(raw: string) {
    super('AI 返回的格式不对');
    this.raw = raw;
  }
}

/** 宽松地从一段文字里抠出 JSON：去掉 ```json 包裹、注释、尾逗号、中文引号，找第一个配平的 {...} */
export function parseLooseJSON<T>(text: string): T | null {
  if (!text) return null;
  const tries: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1]);
  tries.push(text);
  for (const t of tries) {
    const start = t.indexOf('{');
    if (start === -1) continue;
    // 找配平的结束括号（跳过字符串里的括号）
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = end === -1 ? t.slice(start) : t.slice(start, end + 1);
    const variants = [
      body,
      body
        .replace(/\/\/[^\n"]*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'"),
    ];
    for (const v of variants) {
      try {
        return JSON.parse(v) as T;
      } catch {}
    }
  }
  return null;
}

/**
 * 让模型输出 JSON，并尽量容错：
 * 1) 要求 JSON 输出模式（不支持的话自动退回普通模式）；2) 宽松解析；
 * 3) 还不行就让模型把自己的回答「改写成 JSON」再试一次；4) 实在不行抛 AiFormatError（带原文）。
 */
/** 最近一次 callChatJSON 的模型原文（解析出来没有内容时，调用方可以拿它兜底显示） */
export let lastJSONRaw = '';

export async function callChatJSON<T>(messages: ChatMessage[], opts?: { model?: string; extra?: Record<string, unknown> }): Promise<T> {
  const base = { temperature: 0.3, maxTokens: 6000, model: opts?.model };
  let text: string;
  try {
    text = await callChat(messages, { ...base, extra: { response_format: { type: 'json_object' }, ...(opts?.extra ?? {}) } });
  } catch (e: any) {
    if (!/response_format|json_object|json mode/i.test(String(e?.message))) throw e;
    text = await callChat(messages, { ...base, extra: opts?.extra });
  }
  lastJSONRaw = text;
  const first = parseLooseJSON<T>(text);
  if (first) return first;
  try {
    const fixed = await callChat(
      [
        { role: 'system', content: '把用户给你的内容整理成一个合法的 JSON 对象并只输出这个 JSON。保持原意，不要增删信息。如果原文不是 JSON，就输出 {"reply": 原文, "actions": []}。' },
        { role: 'user', content: text.slice(0, 12000) },
      ],
      { temperature: 0, maxTokens: 6000, extra: { response_format: { type: 'json_object' } } }
    );
    const second = parseLooseJSON<T>(fixed);
    if (second) return second;
  } catch {}
  throw new AiFormatError(text);
}
