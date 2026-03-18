# TAOFLOW — Bittensor Observer

实时追踪 Bittensor 子网资金流向的观察工具。

## 项目结构

```
TaoFlow/
├── worker/          # Cloudflare Worker（后端 API）
│   ├── wrangler.toml
│   ├── src/index.js
│   └── seed.json    # KV 初始数据
└── frontend/        # React 前端
    ├── src/App.jsx
    └── ...
```

---

## 前置要求

- Node.js >= 18
- Cloudflare 账号（免费计划即可）
- `wrangler` CLI：`npm install -g wrangler`

---

## 一、部署 Cloudflare Worker

### 1. 登录 Wrangler

```bash
wrangler login
```

浏览器会弹出 Cloudflare 授权页面，完成后返回终端。

### 2. 创建 KV Namespace

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

### 3. 写入初始数据

```bash
# 在 worker/ 目录下执行
wrangler kv:key put --binding=TAOFLOW_KV taoflow_data "$(cat seed.json)"
```

Windows PowerShell 用户请改用：

```powershell
$data = Get-Content seed.json -Raw
wrangler kv:key put --binding=TAOFLOW_KV taoflow_data $data
```

验证写入成功：

```bash
wrangler kv:key get --binding=TAOFLOW_KV taoflow_data
```

### 4. 发布 Worker

```bash
wrangler deploy
```

成功后输出 Worker URL，格式为：

```
https://taoflow-api.<你的子域名>.workers.dev
```

记下这个 URL，前端配置时需要用到。

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

## 三、更新 KV 数据

每次 Bittensor 链上数据变化后，更新 KV 即可，前端 30 秒自动轮询：

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

## 四、CORS 说明

Worker 对所有来源返回以下响应头，前端跨域请求无需额外配置：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

如需限制来源，将 `wrangler.toml` 里对应头改为你的 Pages 域名即可：

```js
// worker/src/index.js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://taoflow.pages.dev',
  // ...
};
```

---

## 五、常见问题

**Q: `wrangler kv:key put` 报错 `No KV namespace found`**
A: 确认 `wrangler.toml` 里的 `id` 已填写，且在正确目录下执行命令。

**Q: 前端显示 "No data found"**
A: KV 里还没有 `taoflow_data` 这个 key，执行第一步的写入命令。

**Q: 前端显示网络错误**
A: 检查 `.env` 里的 `VITE_API_URL` 是否正确，以及 Worker 是否已成功 deploy。

**Q: 数据不更新**
A: Worker 返回 `Cache-Control: max-age=30`，CDN 缓存最多 30 秒。更新 KV 后等待约 30 秒即可看到新数据。
