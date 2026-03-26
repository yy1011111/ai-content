export const WECHAT_DEFAULT_CSS = `
  .wechat-article {
    max-width: 100%;
    margin: 0;
    color: #1f2937;
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 17px;
    line-height: 1.92;
    letter-spacing: 0.08px;
    word-break: break-word;
  }

  .wechat-article,
  .wechat-article * {
    box-sizing: border-box;
  }

  .wechat-article > *:first-child {
    margin-top: 0 !important;
  }

  .wechat-article > *:last-child {
    margin-bottom: 0 !important;
  }

  .wechat-article section,
  .wechat-article article,
  .wechat-article div {
    margin: 0 0 22px 0;
  }

  .wechat-article p {
    margin: 0 0 18px 0;
    color: #243041;
    font-size: 17px;
    line-height: 1.92;
    text-align: left;
  }

  .wechat-article .wechat-intro {
    margin: 0 0 28px 0;
    padding: 0 0 20px 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .wechat-article .wechat-lead {
    margin: 0;
    color: #111827;
    font-size: 18px;
    line-height: 1.95;
    font-weight: 500;
  }

  .wechat-article h1 {
    margin: 0 0 24px 0;
    color: #101828;
    font-size: 31px;
    line-height: 1.32;
    font-weight: 800;
    letter-spacing: 0;
  }

  .wechat-article h2 {
    margin: 36px 0 16px 0;
    padding: 0 0 0 14px;
    border-left: 4px solid #111827;
    color: #0f172a;
    font-size: 22px;
    line-height: 1.5;
    font-weight: 800;
  }

  .wechat-article h3 {
    margin: 28px 0 14px 0;
    color: #172033;
    font-size: 19px;
    line-height: 1.58;
    font-weight: 700;
  }

  .wechat-article h4 {
    margin: 22px 0 10px 0;
    color: #172033;
    font-size: 17px;
    line-height: 1.6;
    font-weight: 700;
  }

  .wechat-article h2 + p,
  .wechat-article h3 + p,
  .wechat-article h4 + p {
    margin-top: 0;
  }

  .wechat-article ul,
  .wechat-article ol {
    margin: 0 0 18px 1.4em;
    padding: 0;
  }

  .wechat-article li {
    margin: 0 0 10px 0;
    color: #243041;
    line-height: 1.9;
  }

  .wechat-article blockquote {
    margin: 24px 0;
    padding: 16px 18px;
    border-left: 4px solid #c18f3d;
    border-radius: 0 14px 14px 0;
    background: #fbf7ee;
    color: #374151;
  }

  .wechat-article .wechat-punchline {
    margin: 28px 0;
    padding: 18px 20px;
    border: 1px solid #efe0b7;
    border-radius: 16px;
    background: linear-gradient(180deg, #fffdf8 0%, #fbf6ea 100%);
    color: #2b3443;
    font-size: 17px;
    line-height: 1.88;
    font-weight: 500;
  }

  .wechat-article figure {
    margin: 30px 0 28px;
  }

  .wechat-article img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
    border-radius: 16px;
    background: #f8fafc;
    object-fit: cover;
  }

  .wechat-article figcaption {
    margin-top: 10px;
    text-align: center;
    color: #6b7280;
    font-size: 12px;
    line-height: 1.8;
  }

  .wechat-article hr,
  .wechat-divider {
    margin: 30px auto;
    width: 72px;
    height: 1px;
    border: none;
    background: linear-gradient(
      90deg,
      rgba(148, 163, 184, 0),
      rgba(148, 163, 184, 0.9),
      rgba(148, 163, 184, 0)
    );
  }

  .wechat-article strong {
    color: #101828;
    font-weight: 700;
  }

  .wechat-article em {
    color: #475569;
  }

  .wechat-article a {
    color: #1d4ed8;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }

  .wechat-article code {
    padding: 2px 6px;
    border-radius: 6px;
    background: #f3f4f6;
    color: #111827;
    font-family: Consolas, Monaco, monospace;
    font-size: 0.95em;
  }
`;

export const WECHAT_HEADER_HTML = '';

export const WECHAT_FOOTER_HTML = '';
