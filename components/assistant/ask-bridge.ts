/**
 * 从别的页面（比如日历弹窗）把一句话交给「今天」页的 AI：
 * 先存起来、切到今天页，今天页打开时取走并发送。
 */
export const ASK_AI_EVENT = 'myplan:ask-ai';
let pending: string | null = null;

export function askAi(text: string) {
  pending = text;
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(ASK_AI_EVENT));
}

export function takePendingAsk(): string | null {
  const t = pending;
  pending = null;
  return t;
}
