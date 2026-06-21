const fs = require('fs');
const path = require('path');

const RECRUITER_CORE_PATH = path.join(__dirname, '..', 'knowledge', 'recruiter-core.md');
const COACH_CORE_PATH = path.join(__dirname, '..', 'knowledge', 'coach-core.md');

describe('loadCore', () => {
  test('reads recruiter-core.md from disk via fs.readFileSync, not a hardcoded string', () => {
    jest.resetModules();
    const spy = jest.spyOn(fs, 'readFileSync');
    const { loadCore } = require('./knowledge');
    loadCore('recruiter-core');
    expect(spy).toHaveBeenCalledWith(RECRUITER_CORE_PATH, 'utf8');
    spy.mockRestore();
  });

  test('returned text matches the actual file content on disk', () => {
    jest.resetModules();
    const { loadCore } = require('./knowledge');
    const onDisk = fs.readFileSync(RECRUITER_CORE_PATH, 'utf8').trim();
    expect(loadCore('recruiter-core')).toBe(onDisk);
  });

  test('loads coach-core.md content from disk too', () => {
    jest.resetModules();
    const { loadCore } = require('./knowledge');
    const onDisk = fs.readFileSync(COACH_CORE_PATH, 'utf8').trim();
    expect(loadCore('coach-core')).toBe(onDisk);
  });

  test('caches after the first read — a second call does not hit the filesystem again', () => {
    jest.resetModules();
    const { loadCore } = require('./knowledge');
    loadCore('recruiter-core');
    const spy = jest.spyOn(fs, 'readFileSync');
    loadCore('recruiter-core');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('loadDiscipline / saveDiscipline', () => {
  const TEST_FIELD = 'Test Discipline For Unit Tests';
  const DISCIPLINE_PATH = path.join(__dirname, '..', 'knowledge', 'disciplines', 'test-discipline-for-unit-tests.json');

  afterEach(() => {
    if (fs.existsSync(DISCIPLINE_PATH)) fs.unlinkSync(DISCIPLINE_PATH);
  });

  test('loadDiscipline returns null when no store exists yet for this field', () => {
    jest.resetModules();
    const { loadDiscipline } = require('./knowledge');
    expect(loadDiscipline(TEST_FIELD)).toBeNull();
  });

  test('saveDiscipline persists to a filename slugified from the field name, and loadDiscipline reads it back', () => {
    jest.resetModules();
    const { loadDiscipline, saveDiscipline } = require('./knowledge');
    const store = { field: TEST_FIELD, updated: '2026-01-01', skills: [{ text: 'Test skill', confidence: 1 }], keywords: [], red_flags: [] };
    saveDiscipline(TEST_FIELD, store);
    expect(fs.existsSync(DISCIPLINE_PATH)).toBe(true);
    expect(loadDiscipline(TEST_FIELD)).toEqual(store);
  });
});

describe('recruiter persona is data-driven', () => {
  test('editing knowledge/recruiter-core.md on disk changes what a fresh load returns', () => {
    // Proves the HR system prompt's core text genuinely comes from the .md file rather than
    // being duplicated/hardcoded elsewhere — mutate a temp copy, point a fresh module load at
    // it indirectly by reading the same path loadCore reads, and confirm the content matches.
    const original = fs.readFileSync(RECRUITER_CORE_PATH, 'utf8');
    const marker = '\n\nTEST MARKER — temporary, proves this file is read live.';
    fs.writeFileSync(RECRUITER_CORE_PATH, original + marker);
    try {
      jest.resetModules();
      const { loadCore } = require('./knowledge');
      expect(loadCore('recruiter-core')).toContain('TEST MARKER');
    } finally {
      fs.writeFileSync(RECRUITER_CORE_PATH, original);
    }
  });
});
