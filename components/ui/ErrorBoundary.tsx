/**
 * 页面出错时不再整页空白：显示出错信息，可以「重试」或复制错误发给开发者。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = { name: string; children: React.ReactNode };
type State = { error: Error | null; info: string };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ info: info?.componentStack ?? '' });
    console.error('[MyPlan]', this.props.name, error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const text = `页面：${this.props.name}\n错误：${error.message}\n${(error.stack || '').split('\n').slice(0, 6).join('\n')}\n${info.split('\n').slice(0, 8).join('\n')}`;
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>😵 这个页面出错了</Text>
        <Text style={styles.muted}>数据没有丢。可以先点「重试」；如果还是不行，把下面的错误信息截图或复制发给开发者。</Text>
        <Text selectable style={styles.code}>
          {text}
        </Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => this.setState({ error: null, info: '' })}>
            <Text style={styles.btnText}>重试</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghost}
            onPress={() => {
              try {
                (navigator as any).clipboard?.writeText(text);
              } catch {}
            }}
          >
            <Text style={styles.link}>复制错误信息</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { padding: 20, maxWidth: 820 },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  muted: { fontSize: 14, color: '#607D8B', marginBottom: 12, lineHeight: 20 },
  code: { fontFamily: 'monospace', fontSize: 12, color: '#B71C1C', backgroundColor: '#FFF5F5', borderRadius: 8, padding: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  ghost: { paddingVertical: 8 },
  link: { color: '#1976D2', fontSize: 14 },
});
