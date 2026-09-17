# 博客（weixin-blog）

个人博客网站，由「公众号搭子」在写作/洗稿任务完成后自动同步文章。配色与公众号搭子官网一致（微信绿主题），文章正文沿用公众号排版 HTML 原样呈现。

- **技术栈**：Hono（Worker API）+ React 18 + Vite（SPA）+ Cloudflare Workers + KV
- **部署目标**：Cloudflare Workers（静态资产 + API 同一 Worker，存储 KV）

## 目录结构

```
blog/
├─ src/                  # React SPA（首页列表 / 文章详情 / 关于页）
│  ├─ pages/ components/ api.ts styles.css
├─ worker/
│  ├─ index.ts           # Hono 应用：公开读接口 + Bearer 写接口 + 静态资产回退
│  └─ kv.ts              # KV 读写（post:<id> 全文 + index:posts 列表索引）
├─ shared/types.ts       # SPA 与 Worker 共用的类型
├─ wrangler.jsonc        # Workers 配置（KV binding、assets）
└─ .dev.vars             # 本地开发 secret（不提交）
```

## 本地开发

```powershell
npm install
npm run build      # 首次需先构建一次（wrangler dev 要求 dist/client 存在）
npm run dev        # concurrently：vite(5173) + wrangler dev(8787)
```

浏览器访问 http://localhost:5173（vite 将 `/api` 代理到 8787 的 Worker；KV 为本地模拟，token 读自 `.dev.vars`）。

## API

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/posts` | 公开 | 文章列表（按创建时间倒序；`?q=` 按 id/标题关键字过滤；`?limit=&offset=` 分页，返回 `total`/`hasMore`） |
| GET | `/img/:key` | 公开 | 静态图片（内容哈希键，immutable + KV 边缘缓存） |
| PUT | `/api/posts/:sourceId` | Bearer | 同步/更新文章（幂等，同 id 覆盖不重复） |
| DELETE | `/api/posts/:sourceId` | Bearer | 删除文章（本体 + 索引条目；图片键可能跨文章共享，不清理） |

写接口示例：

```
PUT /api/posts/42
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "标题",                  // 必填
  "contentHtml": "<p>…</p>",       // 必填，微信排版内联样式 HTML；<img> 支持 data URI 内嵌
  "author": "", "digest": "…", "coverUrl": "https://… 或 data:image/…;base64,…",
  "tags": ["AI"], "sourceCreatedAt": 1730000000000
}

200 → { "ok": true, "created": true|false, "post": { …摘要 }, "transferred": 2 }
401 / 400 / 413 / 500 → { "error": { "code": "…", "message": "…" } }

DELETE /api/posts/42 → 200 { "ok": true, "deleted": true } / 404
```

**图片转存**：PUT 时服务端把 `contentHtml`/`coverUrl` 中的 `data:image/*;base64` 解码，按内容 SHA-256 命名（`img:<hash>.<ext>`）转存 KV，并把 src 改写为 `/img/<hash>.<ext>`；单图解码失败/超 15MB 时把 src 还原为标签 `data-src` 里的原链接（无 data-src 则不动）。`/img/:key` 带 `Cache-Control: public, max-age=31536000, immutable` + KV `cacheTtl` 86400 双层缓存。请求体上限 24MB（含 base64 膨胀），单图解码后上限 15MB。

CORS 白名单：`https://mp.weixin.qq.com`（油猴脚本）+ `http://localhost:5173`（本地联调）。

## 部署

首次部署需先创建 KV namespace，并把输出的 id 填入 `wrangler.jsonc` 的 `kv_namespaces`（当前配置已填好，换账号/重建时才需要）：

```powershell
npx wrangler kv namespace create BLOG_KV   # 输出 id → 填入 wrangler.jsonc
npx wrangler secret put BLOG_API_TOKEN     # 设置写接口 token
npm run deploy                             # 构建并部署
```

部署后将 Worker 地址（如 `https://weixin-blog.<子域>.workers.dev`）和同一 token 填入公众号搭子：**设置 → 博客**，开启「自动同步」即可；文章管理页也提供单篇/批量手动同步。

