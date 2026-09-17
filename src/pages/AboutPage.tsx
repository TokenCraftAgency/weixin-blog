export default function AboutPage() {
  return (
    <div className="about">
      <h1>关于本站</h1>
      <p>
        这是一份个人博客，文章由「公众号搭子」在公众号后台完成写作与洗稿后自动同步而来，
        正文沿用公众号排版直接呈现。
      </p>
      <p>本站部署在 Cloudflare Workers 上，数据存储于 Cloudflare KV。</p>
      <span className="about__badge">由 公众号搭子 驱动</span>
    </div>
  );
}
