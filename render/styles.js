'use strict';

// ── Shared CSS (used by both standalone template and comparison) ───────────────
const CV_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #f4f4f4; }
  .page { max-width: 860px; margin: 40px auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .tailored-badge { display: inline-block; margin-top: 6px; background: #185FA5; color: white; font-size: 11px; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.3px; }
  .tailored-badge strong { font-weight: 600; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .ci { display: flex; align-items: center; gap: 5px; }
  .ci-i { font-size: 13px; color: rgba(255,255,255,0.5); flex-shrink: 0; user-select: none; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.75); }
  .contact-bar a  { font-size: 13px; color: #4A9FE0; text-decoration: none; }
  .li-url { color: #4A9FE0; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year   { font-size: 11px; color: #185FA5; margin-top: 2px; }
  .extra-item { font-size: 12px; color: #555; line-height: 1.6; padding: 2px 0; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .kq-list { padding-left: 16px; margin-bottom: 24px; }
  .kq-list li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 3px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role   { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }
`;

module.exports = { CV_CSS };
