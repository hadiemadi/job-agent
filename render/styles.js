'use strict';

// ── Shared CSS (used by both standalone template and comparison) ───────────────
// Tokens here are the SAME values as public/style.css's :root — kept in sync by value
// since this gets injected into a separate, server-rendered HTML document and can't
// literally share a stylesheet with the main app shell.
const CV_CSS = `
  :root {
    --ink: #20201E;
    --accent: #185FA5;
    --accent-dark: #0C447C;
    --bg: #F6F6F4;
    --surface: #FFFFFF;
    --border: #E4E4E0;
    --muted: #6B6B66;
    --muted-light: #9A9A95;
    --radius-sm: 6px;
    --radius-md: 10px;
    --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font-ui); color: var(--ink); background: var(--bg); }
  .page { max-width: 860px; margin: 40px auto; background: var(--surface); box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: var(--ink); color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .tailored-badge { display: inline-block; margin-top: 6px; background: var(--accent); color: white; font-size: 11px; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.3px; }
  .tailored-badge strong { font-weight: 600; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .ci { display: flex; align-items: center; gap: 5px; }
  .ci-i { font-size: 13px; color: rgba(255,255,255,0.5); flex-shrink: 0; user-select: none; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.75); }
  .contact-bar a  { font-size: 13px; color: #5BA9E8; text-decoration: none; }
  .li-url { color: #5BA9E8; }
  .accent-line { width: 48px; height: 3px; background: var(--accent); margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F6; padding: 32px 24px; border-right: 1px solid var(--border); }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: var(--ink); }
  .edu-item .school { font-size: 12px; color: var(--muted); }
  .edu-item .year   { font-size: 11px; color: var(--accent); margin-top: 2px; }
  .extra-item { font-size: 12px; color: #555; line-height: 1.6; padding: 2px 0; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #4a4a46; border-left: 3px solid var(--accent); padding-left: 16px; margin-bottom: 28px; }
  .kq-list { padding-left: 16px; margin-bottom: 24px; }
  .kq-list li { font-size: 13px; line-height: 1.6; color: #4a4a46; margin-bottom: 3px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role   { font-size: 15px; font-weight: 600; color: var(--ink); }
  .exp-period { font-size: 12px; color: var(--accent); font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #4a4a46; margin-bottom: 4px; }
  .footer { background: var(--ink); padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }

  @media (max-width: 760px) {
    .page { margin: 0; }
    .body { grid-template-columns: 1fr; }
    .left { border-right: none; border-bottom: 1px solid var(--border); }
    .header, .right { padding: 24px 20px; }
    .left { padding: 24px 20px; }
    .footer { padding: 12px 20px; text-align: left; }
  }
`;

module.exports = { CV_CSS };
