# 本地环境变量配置说明

本项目的真实密钥不要提交到仓库。请在项目根目录创建本地文件：

```text
D:\Dev\projects\CodeSentinel\.env
```

可以从 `.env.example` 复制一份后填写：

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

## 最小可运行配置

只做本地后端冒烟，可以先填：

```bash
PORT=8787
GITHUB_WEBHOOK_SECRET=任意一串你在 GitHub App Webhook 里配置的密钥
GITHUB_TOKEN=你的 GitHub Personal Access Token，公开仓库可先不填
AI_REVIEWER_CONFIG_PATH=.ai-reviewer.yml
FEEDBACK_STORE_PATH=data/feedback.jsonl
AI_DEFAULT_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_SUMMARY_MODEL=deepseek-chat
DEEPSEEK_RISK_MODEL=deepseek-reasoner
```

## GitHub App 私有仓库配置

做私有仓库真实 PR 冒烟时需要：

```bash
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_INSTALLATION_ID=
```

说明：

- `GITHUB_APP_ID`：GitHub App 页面里的 App ID。
- `GITHUB_PRIVATE_KEY`：GitHub App 生成的 private key 内容。后续也可以改成读取文件路径。
- `GITHUB_WEBHOOK_SECRET`：你在 GitHub App Webhook 设置里填写的 Secret。
- `GITHUB_INSTALLATION_ID`：GitHub App 安装到目标仓库后的 Installation ID。

建议权限：

- Contents: Read
- Pull requests: Read & Write
- Issues: Read
- Checks: Read & Write
- Metadata: Read

## 大模型配置

至少选择一个 Provider。`AI_DEFAULT_PROVIDER` 填你实际使用的名称。

### DeepSeek

```bash
AI_DEFAULT_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_SUMMARY_MODEL=deepseek-chat
DEEPSEEK_RISK_MODEL=deepseek-reasoner
```

### OpenAI

```bash
AI_DEFAULT_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_SUMMARY_MODEL=gpt-4o-mini
OPENAI_RISK_MODEL=gpt-4o
```

### Qwen

```bash
AI_DEFAULT_PROVIDER=qwen
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_SUMMARY_MODEL=qwen-turbo
QWEN_RISK_MODEL=qwen-plus
```

### Anthropic

```bash
AI_DEFAULT_PROVIDER=anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_SUMMARY_MODEL=claude-3-5-haiku-latest
ANTHROPIC_RISK_MODEL=claude-3-5-sonnet-latest
```

## 当前阶段暂不必填写

```bash
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

这两个用于 OAuth 授权安装流程，当前优先做 Webhook、Installation Token、Check Run 和 PR 评论回写，可以先留空。
