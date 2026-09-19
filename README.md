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
| GET | `/api/config` | 公开 | 站点配置（当前访问模式 public/admin） |
| GET | `/api/admin/config` | Bearer / 会话 | 管理端完整配置（访问模式 + 门禁参数） |
| PUT | `/api/admin/config` | Bearer / 会话 | 修改访问模式/门禁参数（字段可选，仅更新传入项） |
| GET | `/api/admin/login-logs` | Bearer / 会话 | 登录日志（最近 200 条） |
| GET | `/api/posts` | 公开* | 文章列表（按创建时间倒序；`?q=` 按 id/标题关键字过滤；`?limit=&offset=` 分页，返回 `total`/`hasMore`） |
| GET | `/api/posts/short/:shortId` | 公开 | 文章详情（按 6 位短 ID，分享链接链路；匿名请求边缘缓存 5 分钟） |
| GET | `/api/posts/:id` | 公开* | 文章详情（按源 ID；「管理员访问」模式下仅凭证可访；匿名请求边缘缓存 60 秒） |
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

**详情接口边缘缓存**：两个文章详情端点经 `caches.default`（Cloudflare colo 级 Cache API）缓存——仅匿名 GET 参与，带凭证（API Token / 管理员会话）的请求永远直读 KV，管理员始终看到最新数据；4xx/5xx 不写缓存。TTL：短链接详情 300s、源 ID 详情 60s（后者在公开模式下被列表入口高频走，取更短以压低改文后的可见延迟）。命中时响应带 `x-edge-cache` 头可观测。

**双入口访问**：文章详情有两种 URL——站内列表点击走 `/post/<文章id>`；外部分享走 `/#<短ID>`（如 `https://weixin-blog.g11.workers.dev/#ab3def`，前端重定向到 `/s/<短ID>` 渲染同一篇）。短 ID 在首次同步（PUT）时由服务端随机生成（6 位、去易混字符 0/o/1/i/l），重复同步保持不变；用于分享时防止文章 id 被推理遍历。存量旧文章在下次同步时自动补发短 ID。

注：标记为「公开*」的接口在「管理员访问」模式下需携带凭证（见下节）。

## 管理员设置

入口 `/admin/settings`（登录后导航栏「设置」），分段 Tab 管理：

- **访问权限**：切换网站访问模式（存 KV `config:site`，服务端强制）。
  - 公开访问（默认）：任何人可访问全部页面与接口。
  - 管理员访问：首页列表数据（`GET /api/posts`）与按文章 id 的详情（`GET /api/posts/:id`）仅对携带管理员会话/API Token 者开放，未登录返回 403（前端呈现登录引导）；文章分享短链接（`/api/posts/short/:shortId`）、图片、关于页对所有人开放。
- **门禁设置**：登录失败锁定参数可配置（存 KV `config:gate`，默认值同下）。
- **登录日志**：每次登录尝试记录 时间/IP/指纹前 12 位/UA/结果（成功、密码错、锁定拒绝），存 KV `log:login` 保留最近 200 条。

登录锁定规则（可在门禁设置中调整）：失败同时计入「客户端 IP」与「浏览器指纹」两个独立维度（参数无效/缺失的指纹不参与，避免误伤），任一维度连续错 N 次（默认 5）即两个维度同时锁定 M 分钟（默认 15）；换浏览器（IP 不变）或换 IP（指纹不变）都无法绕过；同时改变两者则计数重置，属该方案固有边界。

## 管理员登录

入口 `/admin/login`（导航栏右上「管理员」），密码即 secret `ADMIN_PASSWORD`：

- 登录成功后颁发无状态会话令牌（HMAC-SHA256 签名，密钥由 `ADMIN_PASSWORD` 派生），**7 天免登录**，存于浏览器 localStorage。
- 登录后首页列表卡片（悬停显现）与文章详情页显示删除按钮，删除走 `DELETE /api/posts/:id`（会话令牌鉴权）；不影响原 Bearer Token 同步链路。
- **失败锁定（双维度）**：失败同时计入「客户端 IP」与「浏览器指纹」两个独立维度，任一维度连续错 5 次即两个维度同时锁定 15 分钟（KV 计数，锁定期间登录返回 429）；换浏览器（IP 不变）或换 IP（指纹不变）都无法绕过锁定。
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

