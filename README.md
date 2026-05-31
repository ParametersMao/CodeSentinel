# CodeSentinel 代码哨兵

CodeSentinel 是一款面向个人开发者、小团队和企业研发团队的 AI 辅助 Pull Request Review 工具。它的目标不是替代评审人，而是把 PR 里的重复阅读、风险初筛、上下文补全和低价值评论降噪交给系统，让开发者和 Reviewer 更快判断：**这个 PR 能不能合，为什么。**

当前版本已经从早期前端原型推进到可真实接入 GitHub PR 的 MVP：支持 GitHub App / Webhook、PR 上下文获取、`.ai-reviewer.yml` 配置解析、规则引擎、模型路由、RAG 原型、PR 报告发布、反馈持久化和运行状态看板。

## 产品说明视频

中文版演示视频：[codesentinel-demo-cn](https://www.bilibili.com/video/BV1XbVD6aE8C?vd_source=840947ad1b6540b2744b26eb60c89154)

本仓库也保留了本地渲染版视频与视频工程：

- [演示视频 MP4](demo-video-cn/renders/codesentinel-demo-cn.mp4)
- [视频脚本](demo-video-cn/SCRIPT.md)
- [视频视觉规范](demo-video-cn/DESIGN.md)

## 为什么做 CodeSentinel

传统 Code Review 在真实团队里经常有三个问题：

- Review 周期长：资深工程师忙，PR 提交后可能要等半天甚至一天。
- 上下文不足：很多工具只看当前 Diff，不知道它是否破坏了配置、权限、调用链或历史架构约束。
- AI 误报太多：如果 AI 对命名、空格、风格建议长篇大论，开发者很快会忽略所有 AI 评论。

CodeSentinel 的产品原则是：**P0/P1 主动拦截，P2 收敛到报告；先给结论，再给证据；先保护合并质量，再减少沟通成本。**

## 产品定位

在 AI 编码逐渐普及后，代码评审不应该只变成“评价开发者本人”。CodeSentinel 把评审对象拆成三层：

- 代码产物：这次 Diff 是否安全、正确、可维护、可测试。
- AI Agent 轨迹：生成过程是否出现循环改写、浅层修复、缺少依据或没有测试假设。
- 人类负责人：谁来确认业务意图、风险取舍和上线责任。

这种设计可以避免把 AI 生成代码的问题简单归咎于个人，同时保留工程团队需要的人类责任边界。未来开发者可能会把 AI Review 的结果再反馈给自己的编码 AI，但最终系统仍然需要帮助团队明确：风险在哪里，证据是什么，谁来决定是否接受。

## 当前能力

### GitHub PR 接入

- 支持 GitHub App 配置。
- 支持 Webhook Secret 校验。
- 支持 `pull_request` 事件触发审查任务。
- 支持异步队列与幂等控制，避免重复分析同一事件。
- 支持 GitHub Check Run 状态更新。
- 支持 PR 首页发布《变更验收报告》。
- 支持高风险发现后给出合并闸口建议。

### 上下文获取

系统不会只读取当前 Diff，而是按层级补齐上下文：

- GitHub PR 元数据、标题、描述、作者、分支信息。
- changed files、patch、变更行数。
- 涉及文件的 full file 内容。
- 依赖配置文件，例如 `package.json`、lockfile、项目配置。
- 仓库根目录 `.ai-reviewer.yml`。
- GitHub Issue 关联信息。
- Jira 需求上下文。
- 历史代码片段与隐式规范索引。

### AI Review 分析

- PR 变更总结：说明新增/修改了什么、影响范围和测试建议。
- 风险识别：识别权限、租户隔离、SQL/查询拼接、危险 DOM、Prompt 循环、缺少测试等风险信号。
- 行级建议：输出风险级别、证据、影响说明和修改建议。
- 健康度评分：帮助 Reviewer 快速判断 PR 当前质量。
- 合并闸口：P0/P1 风险优先进入阻断或强提醒链路。
- 低风险 Checklist：P2 建议默认收敛到报告，降低评论噪声。

### 模型路由

支持按任务选择不同模型，兼顾速度、成本和准确性：

- PR 摘要：优先使用快速低成本模型。
- 意图对齐：使用轻量模型对比 Issue / Jira 与 Diff。
- 架构与安全审查：使用强推理模型处理 P0/P1 候选风险。
- 支持 OpenAI、DeepSeek、Qwen、Anthropic 等 Provider 配置。
- 支持在 Web UI 中配置模型、API Key、Base URL 和具体模型名称。

### RAG 与团队记忆

- 支持隐式规范索引原型。
- 支持从历史代码片段召回相似模式。
- 支持误报、有效建议、漏报补充等反馈持久化。
- 支持团队质量看板展示风险分布、噪声反馈和高频风险。

### Web UI

当前前端包含：

- 接入配置：项目接入、GitHub App、模型 Provider、Jira、本地运行配置。
- 评审工作台：PR 链接分析、健康度评分、P0 Blocker、低风险 Checklist、行级 Review。
- 系统状态：系统健康、上下文覆盖、审查链路、后台任务。
- 团队质量：累计审查、风险分布、误报/漏报反馈闭环。

## 当前可用标准

对个人开发者和小团队来说，当前版本已经可以作为真实可用 MVP 进行接入试用。你需要准备：

- GitHub App：`GITHUB_APP_ID`、`GITHUB_INSTALLATION_ID`、`GITHUB_WEBHOOK_SECRET`、Private Key 文件。
- 大模型配置：至少一个 Provider 的 API Key、Base URL、摘要模型和风险模型。
- 项目规则：仓库根目录 `.ai-reviewer.yml`。
- Webhook 公网地址：本地开发可用内网穿透，正式运行需要部署到公网服务。
- 持久化配置：当前支持轻量本地 JSON 存储，长期团队使用建议升级正式数据库。

需要注意：当前版本适合个人项目、小团队内部试用、产品 Demo 和真实 PR 流程验证；如果要作为企业级长期生产服务，还需要补齐正式数据库、多租户权限、密钥加密、持久化队列、部署脚本和更完整的审计能力。

## 快速开始

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

启动 GitHub App 后端：

```bash
npm run server:dev
```

复制环境变量示例：

```bash
copy .env.example .env
```

常用检查命令：

```bash
npm run lint
npm run build
npm run server:check
npm run server:config-check
npm run server:rules-check
npm run server:model-runtime-check
npm run server:ai-review-check
```

## 配置说明

基础配置可以通过 `.env` 或 Web UI 维护。推荐小团队先在 Web UI 中配置，降低直接编辑环境变量的门槛。

关键配置包括：

- GitHub 接入：Webhook Secret、GitHub Token、GitHub App ID、Private Key、Installation ID。
- 模型 Provider：默认 Provider、API Key、Base URL、摘要模型、风险模型。
- 需求来源：Jira Base URL、账号、Token、项目 Key。
- 本地运行：后端端口、`.ai-reviewer.yml` 路径、反馈日志路径、运行时配置路径。

`.ai-reviewer.yml` 用于定义项目级审查策略，例如核心目录、阻断规则、测试策略、模型路由和发布策略。

## 项目结构

```text
CodeSentinel
├─ src/                         # 前端产品界面
├─ server/                      # GitHub App、上下文、模型、规则、队列、反馈等后端服务
├─ docs/                        # 产品路线图、优化方案、环境配置和上下文设计文档
├─ data/                        # 本地运行时数据与反馈记录
├─ demo-video-cn/               # 中文产品演示视频工程
├─ .ai-reviewer.yml             # 项目审查规则示例
├─ .env.example                 # 环境变量示例
└─ README.md
```

## 当前边界

CodeSentinel 当前已经能进入真实 PR 工作流，但还不是完整企业级 SaaS：

- 数据库仍以轻量本地存储为主，适合 MVP 和小团队试用。
- 队列还不是 Redis / BullMQ 等生产级持久化队列。
- 多租户、组织权限、审计日志和密钥加密仍需加强。
- GitLab Merge Request 兼容还在后续规划中。
- 动态沙盒测试、IDE 实时拦截和业务知识图谱审查仍属于长期方向。

## 后续优化方向

### 工程生产化

- 引入正式数据库，保存运行配置、审查记录、反馈日志、团队策略和索引元数据。
- 引入 Redis / BullMQ 等持久化队列，支持失败重试、延迟任务和任务观测。
- 增加用户体系、团队空间、仓库权限隔离和审计日志。
- 对密钥进行加密存储，避免明文保存在运行时配置里。
- 增加 Docker Compose / 部署脚本，降低小团队接入成本。

### 审查准确性

- 强化 `.ai-reviewer.yml` 规则表达能力。
- 增强调用链、测试文件、依赖配置和历史模式的上下文召回。
- 将误报、漏报、采纳、忽略等反馈反向用于规则权重和模型 Prompt 校准。
- 为 P0/P1 风险增加更严格的证据链要求，减少无依据拦截。

### 平台集成

- 完整支持 GitLab Merge Request。
- 支持 VS Code / JetBrains 插件，把审查能力前移到本地开发阶段。
- 支持自动修复分支，由系统提交修复建议并运行测试。
- 支持研发质量看板，沉淀团队高频风险、Review 耗时、误报趋势和模块质量。

## 颠覆式思考：属于 AI 时代的 Code Review

为什么 MVP 依然感觉像“上个时代的产物”？因为 Pull Request 本身就是一个面向人类异步协作的产物。PR 解决的是跨时区、跨团队、异步沟通的问题。当 AI 可以在几秒钟内读写几万行代码时，还要等开发者写完、提交、发起 PR，再让 AI 去 Review，这本质上仍然偏“事后验尸”。

真正 AI 原生的 Code Review，可能会演变成以下三种形态。

### 1. “结对编程”取代“事后审查”

代码审查不应该只发生在 PR 阶段，而应该前置到光标闪烁的那一刻。未来的 Review 工具会像一个驻留在 IDE 或 Cursor 后台的隐形 Agent。

当开发者的编码 AI 生成一段不符合架构规范的代码时，Review AI 可以在毫秒级发现问题，并在后台完成 AI 与 AI 之间的争论、校验和重写。开发者看到的不是“PR 后被打回”，而是“问题在生成阶段就被拦截”。

理想结果是：PR 阶段的 Review 报告只剩一句话：“已在开发阶段完成实时拦截与对齐，允许直接合并。”

### 2. “动态破坏性测试”取代“静态代码阅读”

人类 Review 代码主要依赖阅读和经验推演，所以才需要大量规范和 checklist。AI 时代的审查工具不应该只停留在静态代码阅读。

系统应该在收到新代码后，自动在云端拉起临时沙盒环境，根据本次修改生成极端边界数据、模拟真实业务流量和压力场景，直接轰炸新分支。

报告不再只是“我觉得这行代码可能导致内存泄漏”，而是：“我在沙盒里用高并发流量攻击了新增接口，内存持续上涨并触发 OOM。这里是 Dump 日志、复现请求和建议重构点。”

### 3. Review 的对象变成“状态机”而不是“文本”

现在的代码在工具眼里通常是一行行文本。未来的工程项目，在 AI 眼里更可能是一个巨大的业务逻辑图或知识图谱。

当开发者或开发 AI 修改某个功能时，Review 工具审核的不再只是 `if/else` 是否写对，而是判断这次修改是否破坏了业务图谱中的状态闭环、权限边界、交易一致性和跨模块契约。

那时 Code Review 更像是给整个系统做一次实时核磁共振：看的是业务状态是否仍然闭合，而不是只盯着文本差异。

## 路线图文档

更多阶段规划见：

- [产品路线图](docs/product-roadmap.md)
- [优化方案与自验收](docs/optimization-plan.md)
- [环境配置说明](docs/env-setup.md)
- [上下文与模型运行时设计](docs/context-and-model-runtime.md)

## 自研原创声明

CodeSentinel 是围绕本项目需求自主设计和实现的产品原型。项目可以参考公开技术方案和通用工程实践，但不复制竞品代码、不搬运他人私有实现、不伪装第三方产品能力。后续迭代也会继续保持自研实现、可解释架构和清晰边界。
