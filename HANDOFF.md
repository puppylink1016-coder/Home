# 交接文档 — 2026-06-23 session

## 当前分支状态
- **main**: 所有代码都在 main 上，最新 commit `4e0de49`
- **claude/eloquent-pasteur-97ccax**: 已合并到 main，可以忽略
- **review-murmurs**: Codex 的分支，`3c71ab5 Add murmurs heartbeat system` 已 cherry-pick 到 main，`0d87f09 Fix thinking display and split bubbles` 故意跳过（main 上有自己的实现）

## 已完成

### Thinking 功能
- 后端：移除 OpenRouter `reasoning` 参数，改用 prompt 驱动的 `[THINKING]...[/THINKING]` 标记
- server.js 流式解析器 `flushPhase()` 检测标记，分流到 `type: 'thinking'` 和 `type: 'token'` SSE 事件
- 数据库存储格式：`<!--DRIFT_THINKING\n...\n-->`（通过 `attachThinkingToContent()`）
- 前端兼容新旧两种格式（`<!--DRIFT_THINKING-->` 和 `[THINKING]...[/THINKING]`）
- 前端用 `message-stack` flex 容器 + `<details>/<summary>` 折叠面板，thinking 显示在气泡上方
- `contentToApiFormat()` 自动剥离 thinking 标记避免回传给模型
- 系统提示注入中文 thinking 指令 + 分气泡指令（`RESPONSE_SPLIT_INSTRUCTION`）

### 分气泡
- 后端 `splitAssistantContent()` 智能分割：`---SPLIT---` > 段落 > 行 > 句子分组
- 前端 streaming 阶段只显示单气泡（避免标记中途完成导致突然裂开），`onDone` 时用服务端分割结果

### 流式渲染优化
- `requestAnimationFrame` 节流，不再每个 token 触发 React 重渲染
- `onDone` 显式传 `thinking` 字段给第一条消息

### Murmurs 心跳系统
- 从 review-murmurs 分支 cherry-pick 并手动解决冲突合入 main
- Supabase 表（murmurs + push_logs）已建好
- HEARTBEAT_SECRET 环境变量已设
- heartbeat/run 响应精简到 `{ok: bool}`
- murmurs/run 响应也已精简

### 推送通知
- VAPID keys 已配置
- push_subscriptions 表已建
- 手动 force 测试成功（收到了推送）

### 记忆系统修复
- `save_memory` 工具调用现在同时写入 Ombre Brain + Supabase 镜像（`[ombre]` 前缀）
- `GET /api/memories`（核心记忆列表）加了 `.not('summary', 'like', '[ombre]%')` 过滤
- 昭昭之前删了 Supabase 里所有 `[ombre]` 前缀的条目，Drift 语义记忆列表暂时为空
- Ombre Brain 本体数据完好，对话中语义搜索正常工作
- 新记忆会随对话自然回填到两边

## 待确认 / 待修复

### 1. Drift 前端变更未生效
昭昭强制刷新后说没看到变化。代码确认已在 main 上（`cbebad5`），Vercel 应该自动部署了。可能需要：
- 再次清浏览器缓存（包括 Service Worker）
- 检查 Vercel dashboard 确认部署成功
- DevTools → Network 看 JS 文件的 last-modified 是否是最新的

### 2. cron-job.org 定时心跳
配置：POST `https://anchor-uohz.onrender.com/api/heartbeat/run`，Header 带 `Authorization: Bearer HEARTBEAT_SECRET` + `Content-Type: application/json`，间隔1小时。

问题：时好时坏，"output too large" 错误。原因大概率是 Render 免费版 cold start 返回 HTML loading 页面。

解决方案（未执行）：
- 在 cron-job.org 加一个 keep-alive job：GET `https://anchor-uohz.onrender.com/test-ombre`，间隔14分钟，不需要 header。保持 Render 不 sleep。
- 确认 Render 已部署最新 commit `4e0de49`（heartbeat 只返回 `{ok:bool}`）

### 3. Ombre Brain 作者更新
昭昭说 POluz/Ombre-Brain 仓库有更新，但仓库可能是私有的，无法通过 GitHub API 或 WebFetch 访问。需要昭昭提供更新内容截图或 changelog。

## 延后的功能
- 贴纸/表情包库：等昭昭收集 20-30 张素材
- review-murmurs 分支可以删了（所有需要的代码已在 main）

## 关键文件
- `anchor/server.js` — 后端主文件（thinking 解析、murmurs、记忆、推送）
- `anchor/setup.sql` — 数据库建表 SQL
- `drift/src/App.jsx` — 前端主组件（流式渲染、消息管理）
- `drift/src/components/MessageBubble.jsx` — 消息气泡（thinking 面板、分气泡）
- `drift/src/App.css` — 样式（message-stack、thinking-panel）
- `drift/src/api.js` — 前端 API 层（onThinking handler）
- `drift/src/components/Settings.jsx` — 设置面板（含 murmurs 测试按钮）
- `drift/src/components/Memories.jsx` — 记忆库界面
