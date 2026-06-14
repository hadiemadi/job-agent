function generateExecutiveTemplate(cv, job) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cv.name} — CV for ${job.job_title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; background: #f4f4f4; }
  .page { max-width: 860px; margin: 40px auto; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
  .header { background: #2C2C2A; color: white; padding: 40px 48px; }
  .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
  .header .job-title { font-size: 14px; color: rgba(255,255,255,0.6); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  .contact-bar { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; }
  .contact-bar span { font-size: 13px; color: rgba(255,255,255,0.7); }
  .contact-bar a { color: #4A9FE0; text-decoration: none; font-size: 13px; }
  .accent-line { width: 48px; height: 3px; background: #185FA5; margin: 12px 0; }
  .body { display: grid; grid-template-columns: 1fr 2.2fr; }
  .left { background: #F8F8F7; padding: 32px 24px; border-right: 1px solid #E8E8E6; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #185FA5; margin-bottom: 12px; margin-top: 28px; }
  .left .section-title:first-child { margin-top: 0; }
  .skill-tag { display: inline-block; background: white; border: 1px solid #E0E0E0; border-radius: 4px; padding: 4px 10px; font-size: 12px; margin: 3px 3px 3px 0; color: #444; }
  .edu-item { margin-bottom: 14px; }
  .edu-item .degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item .school { font-size: 12px; color: #666; }
  .edu-item .year { font-size: 11px; color: #185FA5; margin-top: 2px; }
  .right { padding: 32px 36px; }
  .summary { font-size: 13.5px; line-height: 1.7; color: #555; border-left: 3px solid #185FA5; padding-left: 16px; margin-bottom: 28px; }
  .exp-item { margin-bottom: 24px; }
  .exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
  .exp-role { font-size: 15px; font-weight: 600; color: #2C2C2A; }
  .exp-period { font-size: 12px; color: #185FA5; font-weight: 500; white-space: nowrap; }
  .exp-company { font-size: 13px; color: #666; margin-bottom: 8px; }
  .exp-bullets { padding-left: 16px; }
  .exp-bullets li { font-size: 13px; line-height: 1.6; color: #555; margin-bottom: 4px; }
  .footer { background: #2C2C2A; padding: 12px 48px; text-align: right; }
  .footer span { font-size: 11px; color: rgba(255,255,255,0.3); }
  @media print { body { background: white; } .page { box-shadow: none; margin: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${cv.name || 'Your Name'}</h1>
    <div class="job-title">${cv.title || job.job_title}</div>
    <div class="accent-line"></div>
    <div class="contact-bar">
      ${cv.email ? `<span>✉ ${cv.email}</span>` : ''}
      ${cv.phone ? `<span>✆ ${cv.phone}</span>` : ''}
      ${cv.location ? `<span>📍 ${cv.location}</span>` : ''}
      ${cv.linkedin ? `<a href="${cv.linkedin}">LinkedIn</a>` : ''}
    </div>
  </div>
  <div class="body">
    <div class="left">
      <div class="section-title">Skills</div>
      ${(cv.skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('')}
      <div class="section-title">Education</div>
      ${(cv.education || []).map(e => `
        <div class="edu-item">
          <div class="degree">${e.degree}</div>
          <div class="school">${e.school}</div>
          <div class="year">${e.year}</div>
        </div>
      `).join('')}
    </div>
    <div class="right">
      <div class="section-title">Profile</div>
      <div class="summary">${cv.summary || ''}</div>
      <div class="section-title">Experience</div>
      ${(cv.experience || []).map(exp => `
        <div class="exp-item">
          <div class="exp-header">
            <div class="exp-role">${exp.role}</div>
            <div class="exp-period">${exp.period}</div>
          </div>
          <div class="exp-company">${exp.company}</div>
          <ul class="exp-bullets">
            ${(exp.bullets || []).map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  </div>
  <div class="footer">
    <span>Tailored for ${job.job_title} at ${job.company}</span>
  </div>
</div>
</body>
</html>`;
}

module.exports = { generateExecutiveTemplate };
