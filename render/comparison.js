'use strict';

const { CV_CSS } = require('./styles');
const { renderCVPage } = require('./cvHtml');

// ── Comparison page ───────────────────────────────────────────────────────────
// Both sides use renderCVPage — same sections, same content as standalone CV.
// Only difference: no editability, original side has no badge, tailored side gets highlights.
function generateComparisonTemplate(originalCv, tailoredCv, job, modifiedSections = []) {
  const highlighted = new Set(modifiedSections);

  const origPage = renderCVPage(originalCv, job, {
    editable:   false,
    showBadge:  false,
    footerText: 'Original CV',
  });

  const tailPage = renderCVPage(tailoredCv, job, {
    editable:    false,
    highlighted,
    showBadge:   false,
    footerText:  `Tailored for ${job.job_title || ''} at ${job.employer_name || job.company || ''}`,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CV Comparison — ${job.job_title || ''}</title>
<style>
${CV_CSS}
  /* Comparison overrides */
  body { background: #e8e8e6; padding: 0; }
  .page { margin: 0; }

  /* edu-item class overrides */
  .edu-item-degree { font-size: 13px; font-weight: 600; color: #2C2C2A; }
  .edu-item-school { font-size: 12px; color: #666; }
  .edu-item-year   { font-size: 11px; color: #185FA5; margin-top: 2px; }

  /* Comparison chrome */
  .comp-header { background: #2C2C2A; color: white; padding: 14px 32px; }
  .comp-header h1 { font-size: 15px; font-weight: 500; }
  .col-labels { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 14px auto 4px; padding: 0 24px; }
  .col-label  { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #999; text-align: center; }
  .col-label.right { color: #185FA5; }
  .legend     { max-width: 1380px; margin: 0 auto 8px; padding: 0 24px; display: flex; align-items: center; gap: 8px; }
  .legend-box { width: 14px; height: 14px; background: #fffbdd; border: 2px solid #e6a817; border-radius: 2px; flex-shrink: 0; }
  .legend-text { font-size: 12px; color: #666; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1380px; margin: 0 auto 40px; padding: 0 24px; }
  .col  { zoom: 0.62; }
</style>
</head>
<body>
<div class="comp-header">
  <h1>CV Comparison — ${job.job_title || ''}${job.employer_name ? ' at ' + job.employer_name : ''}</h1>
</div>
<div class="col-labels">
  <div class="col-label">Original</div>
  <div class="col-label right">Tailored — highlighted sections changed</div>
</div>
<div class="legend">
  <span class="legend-box"></span>
  <span class="legend-text">Section modified from original</span>
</div>
<div class="cols">
  <div class="col">${origPage}</div>
  <div class="col">${tailPage}</div>
</div>
</body>
</html>`;
}

module.exports = { generateComparisonTemplate };
