# MyPlan · AI 计划秘书

一个懂你精力、会拆任务、自动排程、按真实进度持续调整、还给你留出玩的时间的私人计划工具。用 Expo（React Native）写成，同一套代码跑网页版和 Windows 桌面版。

- 网页版：https://dxy186.github.io/MyPlan/ （推送到 `main` 后由 GitHub Actions 自动发布）
- 使用说明：[docs/AI科学计划秘书-使用说明.md](docs/AI科学计划秘书-使用说明.md)
- 桌面版打包：[desktop/README.md](desktop/README.md)

## 5 个入口

| 入口 | 做什么 |
|:--|:--|
| 🏠 今天 | 正在 / 下一项、跟 AI 说话（直接改计划）、计时、我现在有空、时间轴、早上计划、晚上复盘 |
| 📋 任务 | 统一任务列表（按目标分组、四象限）、目标拆解、任务池导入、WOOP |
| 📅 日历 | 月视图、固定日程管理 |
| 📊 复盘 | 7 天概况、勋章、时间记录、精力、已完成、习惯档案 |
| ⚙️ 设置 | 作息与排程、AI Key、提醒、数据备份 |

## 本地开发

```bash
npm install
npx expo start --web
```

## 代码结构

- `app/_layout.tsx`：侧边栏和 5 个页面的切换
- `app/utils/`：`planning.ts`（数据类型、精力、速率）、`scheduler.ts`（排程引擎）、`ai.ts`（DeepSeek 接口）
- `components/assistant/plan-store.ts`：**统一的数据层**（读写任务、AI 操作、从现在起重排）
- `components/data/`：数据迁移、作息设置、勋章
- `components/assistant/`：今天页（AI、见缝插针、跟进、习惯档案、提醒）
- `components/screens/`：任务、日历、复盘、设置页面
- `components/secretary/`：拆解、任务池、精力、时间记录等面板
- `desktop/`：Electron 桌面版
