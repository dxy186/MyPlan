/**
 * 批量读写本地存储。
 * 当前用的 AsyncStorage v3 没有 multiGet / multiSet / multiRemove，这里用逐个读写代替。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getMany(keys: readonly string[]): Promise<[string, string | null][]> {
  return Promise.all(keys.map(async k => [k, await AsyncStorage.getItem(k)] as [string, string | null]));
}

export async function setMany(pairs: [string, string][]): Promise<void> {
  await Promise.all(pairs.map(([k, v]) => AsyncStorage.setItem(k, v)));
}

export async function removeMany(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map(k => AsyncStorage.removeItem(k)));
}
