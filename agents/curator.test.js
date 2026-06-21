const { mergeFindings, isStale } = require('./curator');

describe('mergeFindings', () => {
  test('merging a new skill into an empty store adds it at confidence 1', () => {
    const result = mergeFindings(null, { skills: ['GaN power amplifier design'] });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({ text: 'GaN power amplifier design', confidence: 1, source_type: 'search' });
    expect(result.updated).toBe(new Date().toISOString().slice(0, 10));
  });

  test('merging the same skill again bumps confidence to 2 and updates last_seen', () => {
    const first = mergeFindings(null, { skills: ['GaN power amplifier design'] });
    const second = mergeFindings(first, { skills: ['GaN power amplifier design'] });
    expect(second.skills).toHaveLength(1); // deduped, not appended as a second entry
    expect(second.skills[0].confidence).toBe(2);
    expect(second.skills[0].last_seen).toBe(new Date().toISOString().slice(0, 10));
  });

  test('a pinned: true entry is untouched by a re-merge', () => {
    const withPin = mergeFindings(null, { skills: [{ text: 'DPD / linearization experience', confidence: 99, source_type: 'user', pinned: true }] });
    expect(withPin.skills[0]).toMatchObject({ pinned: true, confidence: 99 });

    // Re-merging the exact same text (e.g. the Researcher resurfacing it later) must not
    // bump the confidence or strip the pinned flag — user-sourced entries are authoritative.
    const reMerged = mergeFindings(withPin, { skills: ['DPD / linearization experience'] });
    expect(reMerged.skills).toHaveLength(1);
    expect(reMerged.skills[0]).toEqual(withPin.skills[0]);
  });

  test('a new pinned item overrides an existing non-pinned duplicate', () => {
    const searched = mergeFindings(null, { skills: ['RF systems'] });
    const overridden = mergeFindings(searched, { skills: [{ text: 'RF systems', pinned: true }] });
    expect(overridden.skills).toHaveLength(1);
    expect(overridden.skills[0].pinned).toBe(true);
    expect(overridden.skills[0].confidence).toBe(99);
  });

  test('merges keywords and red_flags independently of skills', () => {
    const result = mergeFindings(null, {
      skills: ['RF systems'],
      keywords: ['RFIC', 'ASIC'],
      red_flags: ['no quantified impact'],
    });
    expect(result.skills.map(s => s.text)).toEqual(['RF systems']);
    expect(result.keywords.map(s => s.text)).toEqual(['RFIC', 'ASIC']);
    expect(result.red_flags.map(s => s.text)).toEqual(['no quantified impact']);
  });
});

describe('isStale', () => {
  test('a null store is always stale', () => {
    expect(isStale(null)).toBe(true);
  });
  test('a store updated today is not stale', () => {
    expect(isStale({ updated: new Date().toISOString().slice(0, 10) })).toBe(false);
  });
  test('a store updated 40 days ago is stale', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(isStale({ updated: old })).toBe(true);
  });
});
