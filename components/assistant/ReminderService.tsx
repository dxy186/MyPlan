/**
 * 后台提醒：应用开着时每 30 秒检查一次，到点发系统通知。
 * 放在根布局里，不管当前在哪个页面都生效。
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { reminderTick } from './followup';

export default function ReminderService() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sent = new Set<string>();
    const run = () => {
      reminderTick(sent).catch(() => {});
    };
    run();
    const id = setInterval(run, 30000);
    return () => clearInterval(id);
  }, []);
  return null;
}
