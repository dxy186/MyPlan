import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import CalendarPage from './calendar'; // 复用日历组件

export default function CalendarOnlyScreen() {
  const openFullApp = () => {
    window.location.href = '/';
  };

  return (
    <View style={styles.container}>
      {/* 右上角打开全部功能按钮 */}
      <TouchableOpacity style={styles.openFullBtn} onPress={openFullApp}>
        <Text style={styles.openFullText}>⛶ 打开全部功能</Text>
      </TouchableOpacity>

      {/* 日历主体 */}
      <CalendarPage />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  openFullBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: '#1976D2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#1976D2',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 4,
  },
  openFullText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});