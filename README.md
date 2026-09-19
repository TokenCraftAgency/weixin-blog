# 博客（weixin-blog）

个人博客网站，由「公众号搭子」在写作/洗稿任务完成后自动同步文章。配色与公众号搭子官网一致（微信绿主题），文章正文沿用公众号排版 HTML 原样呈现。

- **技术栈**：Hono（Worker API）+ React 18 + Vite（SPA）+ Cloudflare Workers + KV
- **部署目标**：Cloudflare Workers（静态资产 + API 同一 Worker，存储 KV）

## 目录结构

```
blog/
├─ src/                  # React SPA（首页列表 / 文章详情 / 关于页 / 管理员登录）
│  ├─ pages/ components/ api.ts admin.ts styles.css
├─ worker/
│  ├─ index.ts           # Hono 应用：公开读接口 + Bearer 写接口 + 管理员登录 + 静态资产回退
│  ├─ auth.ts            # 会话令牌：HMAC 签发/校验 + 密码常数时间比对
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

浏览器访问 http://localhost:5173（vite 将 `/api` 代理到 8787 的 Worker；KV 为本地模拟，secret 读自 `.dev.vars`：`BLOG_API_TOKEN`（写接口）与 `ADMIN_PASSWORD`（管理员登录密码），参考 `.dev.vars.example`）。

## API

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/posts` | 公开 | 文章列表（按创建时间倒序；`?q=` 按 id/标题关键字过滤；`?limit=&offset=` 分页，返回 `total`/`hasMore`） |
| GET | `/api/posts/short/:shortId` | 公开 | 文章详情（按 6 位短 ID，分享链接链路） |
| GET | `/img/:key` | 公开 | 静态图片（内容哈希键，immutable + KV 边缘缓存） |
| PUT | `/api/posts/:sourceId` | Bearer | 同步/更新文章（幂等，同 id 覆盖不重复） |
| DELETE | `/api/posts/:sourceId` | Bearer / 会话 | 删除文章（API Token 或管理员会话令牌任一；图片键可能跨文章共享，不清理） |
| POST | `/api/admin/login` | 公开 | 管理员登录（见下节） |

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

**双入口访问**：文章详情有两种 URL——站内列表点击走 `/post/<文章id>`；外部分享走 `/#<短ID>`（如 `https://weixin-blog.g11.workers.dev/#ab3def`，前端重定向到 `/s/<短ID>` 渲染同一篇）。短 ID 在首次同步（PUT）时由服务端随机生成（6 位、去易混字符 0/o/1/i/l），重复同步保持不变；用于分享时防止文章 id 被推理遍历。存量旧文章在下次同步时自动补发短 ID。

## 管理员登录

入口 `/admin/login`（导航栏右上「管理员」），密码即 secret `ADMIN_PASSWORD`：

- 登录成功后颁发无状态会话令牌（HMAC-SHA256 签名，密钥由 `ADMIN_PASSWORD` 派生），**7 天免登录**，存于浏览器 localStorage。
- 登录后首页列表卡片（悬停显现）与文章详情页显示删除按钮，删除走 `DELETE /api/posts/:id`（会话令牌鉴权）；不影响原 Bearer Token 同步链路。
- **失败锁定**：同一「客户端 IP + 浏览器指纹」连续错 5 次锁定 15 分钟（KV 计数，锁定期间登录返回 429）。
- 退出仅需导航栏「退出」（清本地令牌）；令牌无法服务端吊销，怀疑泄露时改 `ADMIN_PASSWORD` 可使全部会话立即失效。

登录接口响应：成功 `200 { ok, token, expiresIn }`；密码错 `401 { error.remaining }`；锁定 `429 { error.retryAfter }`。

## 部署

首次部署需先创建 KV namespace，并把输出的 id 填入 `wrangler.jsonc` 的 `kv_namespaces`（当前配置已填好，换账号/重建时才需要）：

```powershell
npx wrangler kv namespace create BLOG_KV   # 输出 id → 填入 wrangler.jsonc
npx wrangler secret put BLOG_API_TOKEN     # 设置写接口 token
npx wrangler secret put ADMIN_PASSWORD     # 设置管理员登录密码
npm run deploy                             # 构建并部署
```

部署后将 Worker 地址（如 `https://weixin-blog.<子域>.workers.dev`）和同一 token 填入公众号搭子：**设置 → 博客**，开启「自动同步」即可；文章管理页也提供单篇/批量手动同步。

