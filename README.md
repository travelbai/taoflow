# TAOFLOW — Bittensor Observer

实时追踪 Bittensor 子网资金流向的观察工具。

## 项目结构

```
TaoFlow/
├── worker/          # Cloudflare Worker（后端 API）
│   ├── package.json  # Worker 依赖与命令
│   ├── wrangler.toml
│   ├── src/index.js
├── scraper/         # X 列表新闻抓取与 Gemini 中文改写
│   ├── requirements.txt
│   └── news_scraper.py
└── frontend/        # React 前端
    ├── src/App.jsx
    └── ...
```

---

## 前置要求

- Node.js >= 18
- Python >= 3.10（仅新闻抓取需要）
- Cloudflare 账号（免费计划即可）
- `wrangler` CLI：`npm install -g wrangler`

---

## 一、部署 Cloudflare Worker

先安装 Worker 的锁定依赖：

```bash
cd worker
npm ci
```

### 1. 登录 Wrangler

```bash
wrangler login
```

浏览器会弹出 Cloudflare 授权页面，完成后返回终端。

### 2. 配置 Worker 密钥

Worker 读取 Taostats 数据需要 API Key；手动刷新接口也必须使用单独的令牌。生产环境通过 Wrangler 写入，不要把真实值写进 `wrangler.toml`：

```bash
wrangler secret put TAOSTATS_API_KEY
wrangler secret put REFRESH_TOKEN
```

本地开发时，将 `worker/.dev.vars.example` 复制为 `worker/.dev.vars` 并填写相同变量。

### 3. 创建 KV Namespace

```bash
cd worker
wrangler kv:namespace create TAOFLOW_KV
```

命令输出类似：

```
🌀 Creating namespace with title "taoflow-api-TAOFLOW_KV"
✅ Success! Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "TAOFLOW_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

将输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "TAOFLOW_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # ← 替换这里
preview_id = ""                           # 可留空或再建一个 preview namespace
```

如需 preview namespace（本地 `wrangler dev` 使用）：

```bash
wrangler kv:namespace create TAOFLOW_KV --preview
```

将输出的 `id` 填入 `preview_id`。

### 4. 发布 Worker

```bash
wrangler deploy
```

成功后输出 Worker URL，格式为：

```
https://taoflow-api.<你的子域名>.workers.dev
```

记下这个 URL，前端配置时需要用到。

Worker 发布后会按 `wrangler.toml` 中的 Cron 定时刷新核心数据（每 20 分钟）和完整数据（每 2 小时）。首次刷新前前端可能没有数据；也可使用 `POST /refresh?token=<REFRESH_TOKEN>&type=core` 立即触发一次刷新。

### 5. 本地调试（可选）

```bash
wrangler dev
```

本地默认监听 `http://localhost:8787`。

---

## 二、部署前端

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 配置 API 地址

```bash
cp .env.example .env
```

编辑 `.env`，填入第一步得到的 Worker URL：

```env
VITE_API_URL=https://taoflow-api.<你的子域名>.workers.dev
```

### 3. 本地开发

```bash
npm run dev
```

浏览器访问 `http://localhost:5173`。

### 4. 生产构建

```bash
npm run build
```

产物输出到 `dist/` 目录。

### 5. 部署到 Cloudflare Pages（推荐）

```bash
# 在 frontend/ 目录下
wrangler pages deploy dist --project-name=taoflow
```

首次部署会自动创建 Pages 项目，之后访问：

```
https://taoflow.pages.dev
```

#### 在 Pages 控制台配置环境变量

进入 Cloudflare Dashboard → Pages → taoflow → Settings → Environment Variables，添加：

| 变量名 | 值 |
|---|---|
| `VITE_API_URL` | `https://taoflow-api.<你的子域名>.workers.dev` |

> **注意**：Vite 的 `VITE_*` 环境变量在**构建时**注入，Pages 的运行时环境变量对它无效。
> 正确做法是在 Pages 项目的 **Build** 阶段设置，或直接在 `.env` 里写死后 `npm run build`。

---

## 三、更新 KV 数据（可选）

链上数据由 Worker 的定时任务自动更新，通常无需手动写入 KV。仅在迁移或排障时才使用下面的方式直接覆盖 `taoflow_data`：

```bash
# 准备新数据文件 new_data.json，格式同 seed.json
wrangler kv:key put --binding=TAOFLOW_KV taoflow_data "$(cat new_data.json)"
```

### KV 数据格式

```jsonc
{
  "subnets": [
    {
      "id": 1,
      "name": "Prompting",
      "price": 0.8520,        // TAO 单价
      "priceChange": 5.2,     // 24H 价格变化百分比
      "netFlow4H": 1200,      // 4 小时净流入（正=流入，负=流出）
      "netFlow24H": 5400,
      "netFlow7D": 12500,
      "netFlow1M": 45000,
      "emission": 12.50,      // 出块奖励占比 %
      "roi": 12.5,
      "smartMoney": true,     // 是否有巨鲸信号
      "smartMoneyTime": "3h 15m",  // 巨鲸最近活跃时间（可选）
      "isNew": false          // 是否新子网（可选）
    }
    // ...更多子网
  ],
  "timeline": [
    {
      "type": "registration",
      "time": "10 mins ago",
      "title": "SN128 注册成功",
      "creator": "5Grw...",
      "fee": 512,
      "feeTrend": "up"        // "up" | "flat" | "down"
    }
    // ...更多记录
  ],
  "meta": {
    "activeSubnets": 128,
    "totalSubnets": 128,
    "recycleFee": 512,
    "recycleFeeUp": true,     // 注册费是否上涨中
    "updatedAt": "2026-03-15T10:30:00Z"
  }
}
```

---

## 四、新闻抓取

```bash
cd scraper
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

在 `.env` 中填写 X 会话 Cookie、Gemini API Key 和 Cloudflare KV 凭证后运行：

```bash
python news_scraper.py
```

Windows 下也可使用 `run_scraper.bat` 或 `run_hidden.vbs`。脚本会优先使用 `py -3`，找不到 Python 时会在 `scraper.log` 中留下明确提示。

## 五、CORS 说明

Worker 仅允许生产前端和本地开发来源，当前白名单在 `worker/src/index.js` 的 `ALLOWED_ORIGINS` 中维护：

```
https://taoflow.pages.dev
http://localhost:<任意端口>
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

如需增加站点来源，请修改该数组后重新部署 Worker：

```js
// worker/src/index.js
const ALLOWED_ORIGINS = ['https://taoflow.pages.dev', 'https://example.com'];
```

---

## 六、验证与常见问题

每次提交会由 GitHub Actions 完成前端构建、Worker 语法检查和抓取器语法检查。本地可分别运行：

```bash
cd frontend && npm run build
cd worker && npm run check
cd scraper && python -m py_compile news_scraper.py
```

**Q: `wrangler kv:key put` 报错 `No KV namespace found`**
A: 确认 `wrangler.toml` 里的 `id` 已填写，且在正确目录下执行命令。

**Q: 前端显示 "No data found"**
A: Worker 首次刷新尚未完成。检查 `TAOSTATS_API_KEY`、KV 绑定和 Cron 日志，或使用带 `REFRESH_TOKEN` 的 `POST /refresh` 手动触发核心刷新。

**Q: 前端显示网络错误**
A: 检查 `.env` 里的 `VITE_API_URL` 是否正确，以及 Worker 是否已成功 deploy。

**Q: 数据不更新**
A: 核心链上数据按 20 分钟刷新，完整注册信息按 2 小时刷新。检查 Cloudflare Worker 的 Cron 日志和 Taostats API Key；新闻由抓取器单独写入 KV。
