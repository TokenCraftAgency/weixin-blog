/** 博客文章摘要（列表索引条目） */
export interface BlogPostSummary {
  /** 来源文章 id（weixin-publisher IndexedDB 自增主键），列表/详情内部链路使用 */
  id: string;
  /** 对外分享短 ID（6 位随机、去易混字符），首次收录时生成、重复同步不变 */
  shortId: string;
  title: string;
  digest: string;
  coverUrl: string;
  tags: string[];
  /** 原文章创建时间（列表排序键） */
  createdAt: number;
  /** 博客首次收录时间（重复同步不变） */
  publishedAt: number;
  /** 最近同步时间 */
  syncedAt: number;
}

/** 博客文章完整内容 */
export interface BlogPost extends BlogPostSummary {
  author: string;
  /** 微信排版后的内联样式 HTML，前台原样渲染 */
  contentHtml: string;
}

/** 站点访问模式：public 任何人可访问；admin 首页/按 id 详情仅限管理员（短链接与关于页公开） */
export type SiteAccess = 'public' | 'admin';

/** 站点配置（KV config:site，管理员设置页维护） */
export interface SiteConfig {
  access: SiteAccess;
}

/** 门禁参数（KV config:gate，管理员设置页维护）：错 failLimit 次锁 lockMinutes 分钟 */
export interface GateConfig {
  failLimit: number;
  lockMinutes: number;
}

/** 登录日志条目（KV log:login，保留最近 200 条） */
export interface LoginLogEntry {
  /** 发生时间（毫秒时间戳） */
  t: number;
  ip: string;
  /** 指纹哈希前 12 位（缺失为空串） */
  fp: string;
  /** 截断后的 UA */
  ua: string;
  /** 结果：成功 / 密码错 / 锁定期拒绝 */
  r: 'ok' | 'fail' | 'locked';
}

/** 同步写接口（PUT /api/posts/:sourceId）请求体 */
export interface SyncPostInput {
  title: string;
  author?: string;
  digest?: string;
  contentHtml: string;
  coverUrl?: string;
  tags?: string[];
  sourceCreatedAt?: number;
}
