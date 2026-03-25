export const WECHAT_DEFAULT_CSS = `
  .wechat-article {
    max-width: 100%;
    color: #1f2937;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 17px;
    line-height: 1.95;
    letter-spacing: 0.12px;
    word-break: break-word;
    background: #ffffff;
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
    margin: 0 0 18px 0;
  }

  .wechat-article p {
    margin: 0 0 18px 0;
    color: #243041;
    font-size: 17px;
    line-height: 1.95;
    text-align: left;
  }

  .wechat-article .wechat-lead {
    margin-bottom: 20px;
    color: #111827;
    font-size: 18px;
    line-height: 1.95;
    font-weight: 500;
  }

  .wechat-article h1 {
    margin: 0 0 24px 0;
    color: #101828;
    font-size: 30px;
    line-height: 1.35;
    font-weight: 800;
    letter-spacing: 0;
  }

  .wechat-article h2 {
    margin: 30px 0 14px 0;
    padding: 0 0 0 12px;
    border-left: 4px solid #111827;
    color: #101828;
    font-size: 21px;
    line-height: 1.55;
    font-weight: 800;
  }

  .wechat-article h3 {
    margin: 24px 0 12px 0;
    color: #172033;
    font-size: 19px;
    line-height: 1.55;
    font-weight: 700;
  }

  .wechat-article h4 {
    margin: 20px 0 10px 0;
    color: #172033;
    font-size: 17px;
    line-height: 1.6;
    font-weight: 700;
  }

  .wechat-article ul,
  .wechat-article ol {
    margin: 0 0 18px 1.5em;
    padding: 0;
  }

  .wechat-article li {
    margin: 0 0 10px 0;
    color: #243041;
    line-height: 1.9;
  }

  .wechat-article blockquote {
    margin: 24px 0;
    padding: 14px 16px;
    border-left: 4px solid #94a3b8;
    border-radius: 0 12px 12px 0;
    background: #f8fafc;
    color: #334155;
  }

  .wechat-article figure {
    margin: 26px 0 28px;
  }

  .wechat-article img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
    border-radius: 16px;
    background: #f8fafc;
  }

  .wechat-article figcaption {
    margin-top: 10px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
    line-height: 1.75;
  }

  .wechat-article hr,
  .wechat-divider {
    margin: 28px auto;
    width: 60px;
    height: 1px;
    border: none;
    background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.9), rgba(148, 163, 184, 0));
  }

  .wechat-article strong {
    color: #101828;
    font-weight: 700;
  }

  .wechat-article em {
    color: #475569;
  }

  .wechat-article a {
    color: #2563eb;
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
