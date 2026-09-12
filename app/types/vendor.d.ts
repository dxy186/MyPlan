// 第三方库缺少类型声明时的本地补丁（不安装新依赖）
declare module 'ical.js' {
  const ICAL: any;
  export default ICAL;
}
