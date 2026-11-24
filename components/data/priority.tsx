/** 任务优先级（四象限）的颜色和小圆点提示 */
import React from 'react';
import { Text } from 'react-native';

import { Quadrant } from '@/app/utils/planning';

export const PRI: { key: Quadrant; label: string; color: string }[] = [
  { key: 'important_urgent', label: '重要紧急', color: '#D84315' },
  { key: 'not_important_urgent', label: '不重要紧急', color: '#EF6C00' },
  { key: 'important_not_urgent', label: '重要不紧急', color: '#2E7D32' },
  { key: 'not_important_not_urgent', label: '不重要不紧急', color: '#90A4AE' },
];
export const priOf = (q?: Quadrant) => PRI.find(p => p.key === q);

/** 标题前的彩色圆点：红 = 重要紧急，橙 = 不重要紧急，绿 = 重要不紧急，灰 = 不重要不紧急；没设优先级不显示 */
export function PriDot({ q, size = 10 }: { q?: Quadrant; size?: number }) {
  const p = priOf(q);
  if (!p) return null;
  return (
    <Text style={{ color: p.color, fontSize: size, fontWeight: '700' }} accessibilityLabel={p.label}>
      {'● '}
    </Text>
  );
}
