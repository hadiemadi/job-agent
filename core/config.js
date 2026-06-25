'use strict';

// Single source of truth for trial-period behavior. Currently controls one thing: whether the
// friendly validation/unavailable popups also show their error code as a quiet caption (see
// public/app.js's showValidationNudge). Default true while in trial — set TRIAL_MODE=false in
// the environment to hide codes on those popups again; that's the only change needed (the
// "one-flag switch" build.txt asked for), no code edits required.
const TRIAL_MODE = process.env.TRIAL_MODE !== 'false';

module.exports = { TRIAL_MODE };
