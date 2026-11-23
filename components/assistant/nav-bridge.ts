/** 提醒被点开后要打开日历里「今天」的弹窗：先记下来，日历页挂载时取走 */
export const OPEN_TODAY_MODAL_EVENT = 'myplan:open-today-modal';
let pendingToday = false;

export function requestOpenToday() {
  pendingToday = true;
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(OPEN_TODAY_MODAL_EVENT));
}

export function takePendingOpenToday() {
  const v = pendingToday;
  pendingToday = false;
  return v;
}
