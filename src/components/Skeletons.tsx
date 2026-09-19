/** 加载骨架屏（shimmer 占位，与真实卡片布局同构，减少内容跳动感） */

export function HomeSkeleton() {
  return (
    <div className="post-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="post-card">
          <div className="sk sk__cover" />
          <div className="post-card__body">
            <div className="sk sk__line sk__line--title" />
            <div className="sk sk__line" />
            <div className="sk sk__line sk__line--short" />
            <div className="sk sk__chip" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PostSkeleton() {
  return (
    <article className="post" aria-hidden="true">
      <div className="sk sk__line sk__line--h1" />
      <div className="sk sk__line sk__line--meta" />
      <div className="sk sk__block" />
      <div className="sk sk__line" />
      <div className="sk sk__line" />
      <div className="sk sk__line sk__line--short" />
      <div className="sk sk__line" />
      <div className="sk sk__line" />
      <div className="sk sk__line sk__line--mid" />
    </article>
  );
}
