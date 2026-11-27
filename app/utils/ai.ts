/**
 * MyPlan · AI 智能体层的统一出口
 *
 * 接 OpenAI 兼容接口的各家服务商（DeepSeek、OpenAI、Kimi、智谱、通义、硅基流动、OpenRouter、Gemini、Claude、Ollama、自定义），见 ai-providers.ts。
 * Key 只有一份：沿用原页面里的常量，本文件不再重复硬编码。
 * 如果以后换 Key / 换模型，用 saveAiConfig() 写入本地配置即可覆盖默认值。
 */

import { KEYS, loadJSON, saveJSON } from './planning';

import { PROVIDERS, ProviderId, modelsUrlOf, providerOf } from './ai-providers';

export type AiProfile = { apiUrl: string; apiKey: string; model: string; visionModel: string };

export type AiConfig = {
  provider: ProviderId;
  apiUrl: string;
  apiKey: string;
  model: string;
  /** 看图用的模型（要支持图片输入） */
  visionModel?: string;
  /** 每个服务商各自的地址 / Key / 模型，切换时不用重填 */
  profiles?: Partial<Record<ProviderId, Partial<AiProfile>>>;
};

/** 某个服务商的完整设置：存过的 + 默认值 */
export function profileOf(saved: Partial<AiConfig>, id: ProviderId): AiProfile {
  const p = providerOf(id);
  const sp = saved.profiles?.[id] ?? {};
  // 老版本只存了 apiKey / model（都是 DeepSeek 的）
  const legacy = id === 'deepseek' ? { apiKey: saved.apiKey, model: saved.model, visionModel: saved.visionModel } : {};
  return {
    apiUrl: (sp.apiUrl ?? '').trim() || p.apiUrl,
    apiKey: (sp.apiKey ?? legacy.apiKey ?? (id === 'deepseek' ? process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY ?? '' : '')).trim(),
    model: (sp.model ?? legacy.model ?? '').trim() || p.model,
    visionModel: (sp.visionModel ?? legacy.visionModel ?? '').trim() || p.visionModel || (sp.model ?? '').trim() || p.model,
  };
}

export async function getAiConfig(): Promise<AiConfig> {
  const saved = await loadJSON<Partial<AiConfig>>(KEYS.aiConfig, {});
  const provider = (PROVIDERS.some(p => p.id === saved.provider) ? saved.provider : 'deepseek') as ProviderId;
  const prof = profileOf(saved, provider);
  // 本机模型不需要 Key：给个占位，调用方「有没有 Key」的判断就能通过
  const apiKey = prof.apiKey || (providerOf(provider).noKey ? 'local' : '');
  return { provider, ...prof, apiKey, profiles: saved.profiles };
}

/** 保存某个服务商的设置，并切换成用它 */
export async function saveAiProfile(id: ProviderId, patch: Partial<AiProfile>): Promise<void> {
  const saved = await loadJSON<Partial<AiConfig>>(KEYS.aiConfig, {});
  const profiles = { ...(saved.profiles ?? {}) };
  profiles[id] = { ...(profiles[id] ?? {}), ...patch };
  await saveJSON(KEYS.aiConfig, { ...saved, provider: id, profiles });
}

/** 兼容老调用：改当前服务商的设置 */
export async function saveAiConfig(patch: Partial<AiConfig>): Promise<void> {
  const cur = await getAiConfig();
  const { apiKey, model, visionModel, apiUrl } = patch;
  await saveAiProfile(patch.provider ?? cur.provider, { apiKey, model, visionModel, apiUrl });
}

type HttpRes = { status: number; text: string };
type DesktopHttp = (req: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<HttpRes>;
/** 桌面版：请求由后台转发，绕开浏览器的跨域限制（本机 Ollama、Claude 等） */
function desktopHttp(): DesktopHttp | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { myplanDesktop?: { http?: DesktopHttp } }).myplanDesktop?.http ?? null);
}

async function httpRequest(url: string, method: string, headers: Record<string, string>, body?: string): Promise<HttpRes> {
  const viaDesktop = desktopHttp();
  if (viaDesktop) return viaDesktop({ url, method, headers, body });
  let r: Response;
  try {
    r = await fetch(url, { method, headers, body });
  } catch (e) {
    throw new Error(
      `连不上 ${new URL(url).host}（${(e as Error).message}）。可能是网络不通，或者这家服务不允许网页直接调用——试试桌面版，或换一家。`
    );
  }
  return { status: r.status, text: await r.text() };
}

function authHeaders(cfg: { provider: ProviderId; apiKey: string }): Record<string, string> {
  const p = providerOf(cfg.provider);
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(p.headers ?? {}) };
  if (cfg.apiKey && cfg.apiKey !== 'local') {
    h.Authorization = `Bearer ${cfg.apiKey}`;
    if (cfg.provider === 'anthropic') h['x-api-key'] = cfg.apiKey;
  }
  return h;
}

function errorMessage(status: number, text: string): string {
  let msg = '';
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message || j?.message || j?.error || '';
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {
    msg = text.slice(0, 200);
  }
  const hint =
    status === 401 || status === 403
      ? '（Key 不对或没有权限）'
      : status === 404
        ? '（地址或模型名不对）'
        : status === 429
          ? '（请求太频繁或余额不足）'
          : '';
  return `${msg || '请求失败'} (${status})${hint}`;
}

/** 列出这个服务商能用的模型（不是每家都支持） */
export async function listModels(id: ProviderId, profile: AiProfile): Promise<string[]> {
  const r = await httpRequest(modelsUrlOf(profile.apiUrl), 'GET', authHeaders({ provider: id, apiKey: profile.apiKey }));
  if (r.status < 200 || r.status >= 300) throw new Error(errorMessage(r.status, r.text));
  const j = JSON.parse(r.text);
  const arr: unknown[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : [];
  return arr
    .map(x => (typeof x === 'string' ? x : (x as { id?: string; name?: string })?.id || (x as { name?: string })?.name || ''))
    .map(x => String(x).replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

export async function callChat(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; model?: string; extra?: Record<string, unknown>; config?: AiConfig }
): Promise<string> {
  const cfg = opts?.config ?? (await getAiConfig());
  if (!cfg.apiUrl) throw new Error('还没填接口地址：到「⚙️ 设置 → 🤖 AI」里填。');
  const r = await httpRequest(
    cfg.apiUrl,
    'POST',
    authHeaders(cfg),
    JSON.stringify({
      model: opts?.model || cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4000,
      ...(opts?.extra ?? {}),
    })
  );
  if (r.status < 200 || r.status >= 300) throw new Error(errorMessage(r.status, r.text));
  let data: { choices?: { message?: { content?: unknown } }[] };
  try {
    data = JSON.parse(r.text);
  } catch {
    throw new Error('AI 返回的不是 JSON：' + r.text.slice(0, 120));
  }
  const content = data.choices?.[0]?.message?.content;
  // 有的服务商把内容拆成数组 [{type:'text', text}]
  const text = Array.isArray(content) ? content.map(c => (c as { text?: string })?.text ?? '').join('') : content;
  return (typeof text === 'string' && text) || '抱歉，我没有给出回复。';
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
    // 不支持 JSON 模式（各家报错不一样，400 / 422 一律退回普通模式再试）
    if (!/response_format|json_object|json mode|\((400|422)\)/i.test(String(e?.message))) throw e;
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
