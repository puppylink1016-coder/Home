# Drift + Anchor 项目架构

## 项目总览

这是一个自托管的 AI 聊天应用，前后端分离。前端叫 **Drift**，后端叫 **Anchor**。用户在 Drift 上发消息，Anchor 负责调用 AI 模型、管理记忆、处理推送。

本质上是一个定制化的 ChatGPT/Claude 前端，但专门为角色扮演场景设计，带有语义记忆系统、对话压缩、thinking 展示、定时心跳（murmurs）等功能。

## 仓库结构

```
Home/
├── drift/          # 前端 — React + Vite，部署在 Vercel
│   ├── src/
│   │   ├── App.jsx              # 主组件：路由、session 管理、流式消息处理
│   │   ├── App.css              # 全局样式
│   │   ├── api.js               # 所有后端 API 调用（REST + SSE 流式）
│   │   ├── config.js            # API_URL 和 AUTH_TOKEN
│   │   ├── context.js           # 收集客户端上下文（时间、日期、时段）
│   │   ├── main.jsx             # 入口
│   │   └── components/
│   │       ├── ChatView.jsx     # 聊天界面（消息列表、输入框、图片上传）
│   │       ├── MessageBubble.jsx # 单条消息气泡（thinking 面板、分气泡）
│   │       ├── Sidebar.jsx      # 侧边栏（session 列表）
│   │       ├── Settings.jsx     # 设置面板（模型、温度、记忆库、推送、murmurs）
│   │       └── Memories.jsx     # 记忆库界面（核心记忆 + 语义记忆）
│   ├── public/
│   │   ├── avatar-ai.jpg        # AI 头像
│   │   ├── manifest.json        # PWA manifest
│   │   └── sw.js                # Service Worker（推送通知接收）
│   └── package.json
│
├── anchor/         # 后端 — Express.js，部署在 Render
│   ├── server.js               # 全部后端逻辑（单文件，约1700行）
│   ├── setup.sql               # 数据库建表 SQL
│   ├── seed-ombre.js           # 语义记忆种子脚本（CLAUDE.md → Ombre Brain）
│   ├── seed-memories.js        # 核心记忆种子脚本
│   ├── seed-nsfw.js            # NSFW 写作规则种子
│   ├── seed-remaining.js       # 其他种子数据
│   └── package.json
│
├── ble/            # 蓝牙 BLE 逆向工程项目（独立，与主项目无关）
├── CLAUDE.md       # Claude Code 角色设定文件（仅在 Claude Code 中生效）
├── HANDOFF.md      # 跨 session 交接文档
└── ARCHITECTURE.md # 本文件
```

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + Vite | 纯 CSS，无 UI 框架 |
| 后端 | Express.js | 单文件 server.js |
| 数据库 | Supabase (PostgreSQL) | 托管在 Supabase 云 |
| AI 模型 | OpenRouter API | 转发到 Claude/DeepSeek 等模型 |
| 语义记忆 | Ombre Brain (MCP Server) | 外部服务，语义检索 + 情感权重 |
| 前端部署 | Vercel | 自动从 main 分支部署 |
| 后端部署 | Render (免费版) | 自动从 main 分支部署，15分钟无活动会休眠 |
| 推送 | Web Push (VAPID) | 浏览器推送通知 |

## 核心数据流

### 用户发消息

```
[Drift 前端]
  1. 用户输入消息（可附带图片）
  2. context.js 收集当前时间上下文
  3. api.js 发起 POST /api/chat/stream（SSE 流式请求）
     body: { message, sessionId, imageUrl?, context: { time } }

[Anchor 后端] /api/chat/stream
  4. 存用户消息到 messages 表
  5. 从 settings 表读配置（模型、温度、上下文轮数等）
  6. 从 memories 表读核心记忆（不含 [ombre] 前缀的条目，全量加载）
  7. 用用户消息查询 Ombre Brain 获取相关语义记忆
  8. 构建 system prompt = thinking指令 + 用户设定 + 分气泡指令 + 时间上下文 + 语义记忆 + 核心记忆
  9. 拼装 messages 数组（system + 最近N轮对话）
  10. 调用 OpenRouter API（流式）
  11. 解析流式响应：
      - [THINKING]...[/THINKING] 标记 → SSE event: { type: 'thinking', content }
      - 正文内容 → SSE event: { type: 'token', content }
      - tool_calls (save_memory) → 存入 Ombre Brain + Supabase 镜像
  12. 流结束后，用 splitAssistantContent() 分割气泡（按 ---SPLIT--- / 段落 / 句子）
  13. 存 assistant 消息到 messages 表（thinking 嵌入为 <!--DRIFT_THINKING\n...\n--> 注释）
  14. 检查消息数量，超过 compress_threshold 则触发异步压缩
  15. SSE event: { type: 'done', messages, sessionId }

[Drift 前端]
  16. 流式阶段：逐 token 渲染单气泡（requestAnimationFrame 节流）
  17. done 阶段：用服务端分割结果重新渲染为多气泡
  18. thinking 内容显示在气泡上方的可折叠面板中
```

### Murmurs 心跳

```
[cron-job.org] 每小时 POST /api/heartbeat/run
  → Anchor 检查最近对话
  → 调用 AI 模型生成一段"碎碎念"（murmur）
  → 存入 murmurs 表
  → 通过 Web Push 推送给用户
```

### 对话压缩

```
当 session 内消息数 ≥ compress_threshold（默认50条）：
  → 取最早的消息（保留最近 compress_keep 条）
  → 用 DeepSeek 压缩成 300-500 字摘要
  → 摘要存入 memories 表（核心记忆，无前缀）+ Ombre Brain
  → 原消息标记 visible=false（不删除，但不再参与对话）
```

## 数据库表

| 表 | 用途 |
|---|---|
| `sessions` | 对话会话（id, name, created_at, updated_at） |
| `messages` | 聊天消息（session_id, role, content, visible） |
| `memories` | 记忆存储。无前缀=核心记忆（全量加载）；`[ombre]` 前缀=语义记忆镜像（不加载，仅展示用） |
| `settings` | 全局设置，单行表（模型、温度、system_prompt、压缩阈值等） |
| `murmurs` | 心跳生成的碎碎念 |
| `push_subscriptions` | Web Push 订阅信息 |
| `push_logs` | 推送日志 |

## 记忆系统

两层记忆架构：

**核心记忆**（memories 表，无 `[ombre]` 前缀）
- 来源：对话压缩器自动生成 + 前端手动添加
- 加载方式：每次对话全量注入 system prompt
- 写入时经过 sanitizeMemory() 防护（检测重复、限制800字）

**语义记忆**（Ombre Brain MCP Server）
- 来源：模型调用 save_memory 工具主动存入 + 种子脚本批量导入
- 加载方式：每次用户发消息时，用消息内容做语义搜索，返回相关记忆片段
- Supabase 中有 `[ombre]` 前缀的镜像副本，仅用于前端列表展示

## 环境变量（Anchor 后端）

| 变量 | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key（绕过 RLS，用于 Storage） |
| `OPENROUTER_API_KEY` | OpenRouter API 密钥 |
| `OMBRE_BRAIN_URL` | Ombre Brain MCP 服务器地址 |
| `VAPID_PUBLIC_KEY` | Web Push 公钥 |
| `VAPID_PRIVATE_KEY` | Web Push 私钥 |
| `VAPID_SUBJECT` | Web Push 联系方式 |
| `HEARTBEAT_SECRET` | 心跳 API 鉴权密钥 |

## 已实现的功能模块

- **流式对话**：SSE 流式输出，逐 token 渲染
- **Thinking 展示**：prompt 驱动的 [THINKING] 标记，前端可折叠面板
- **分气泡**：---SPLIT--- 标记 + 智能段落分割
- **图片发送**：上传到 Supabase Storage，多模态对话
- **记忆系统**：核心记忆（全量）+ 语义记忆（Ombre Brain 检索）
- **对话压缩**：超阈值自动压缩旧消息为摘要
- **推送通知**：VAPID Web Push
- **Murmurs 心跳**：定时生成碎碎念并推送
- **时间感知**：前端收集时间上下文注入 system prompt
- **PWA**：可添加到手机主屏幕

## 开发注意事项

- `anchor/server.js` 是单文件后端，所有路由和逻辑都在里面，约1700行
- 前端无状态管理库，全部用 React useState/useEffect
- 前端无路由库，单页应用
- Render 免费版会休眠，需要 keep-alive 定时请求保活
- Vercel 和 Render 都从 GitHub main 分支自动部署
- 图片存储在 Supabase Storage 的 chat-images bucket
- `contentToApiFormat()` 函数负责在发给模型前剥离 thinking 标记和图片 markdown
