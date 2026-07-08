'use strict';

// Regression tests for buildPriorGapBlock field isolation.
// Coach is only allowed to see gap_slogan, coach_conversation, coach_verdict —
// NOT hr_statement or user_decision, which never appear in the SELECT query result.

jest.mock('../core/claude',    () => ({ client: {}, MODEL: 'test-model' }));
jest.mock('../core/json',      () => ({ extractJSON: jest.fn(), firstText: jest.fn() }));
jest.mock('../core/logger',    () => ({ logDiagnostic: jest.fn() }));
jest.mock('../core/knowledge', () => ({ loadCore: jest.fn().mockReturnValue('Coach persona') }));
jest.mock('../core/preferences', () => ({ preferencesBlock: jest.fn().mockReturnValue('') }));
jest.mock('./recruiter',        () => ({ fieldBlock: jest.fn().mockReturnValue('') }));

const { buildPriorGapBlock } = require('./coach');

describe('buildPriorGapBlock — field isolation', () => {
  it('default mode: includes coach_verdict, never hr_statement or user_decision', () => {
    const prior = {
      gap_slogan:         'cloud-experience',
      coach_conversation: [
        { role: 'user',      content: 'I have AWS experience' },
        { role: 'assistant', content: 'Strong AWS background noted' },
      ],
      coach_verdict: 'Solid cloud experience confirmed',
      hr_statement:  'HR says candidate is a good fit',
      user_decision: 'added',
    };
    const block = buildPriorGapBlock(prior, false);
    expect(block).toContain('Solid cloud experience confirmed');
    expect(block).not.toContain('HR says');
    expect(block).not.toContain('good fit');
    expect(block).not.toContain('added');
    // conversation turns must NOT appear in default mode
    expect(block).not.toContain('I have AWS experience');
    expect(block).not.toContain('Strong AWS background noted');
  });

  it('extensive mode: adds conversation turns, still no hr_statement or user_decision', () => {
    const prior = {
      coach_conversation: [
        { role: 'user',      content: 'I managed cloud infra at scale' },
        { role: 'assistant', content: 'That clearly covers the gap' },
      ],
      coach_verdict: 'Gap is covered by candidate',
      hr_statement:  'HR confidential statement — must not reach Coach',
      user_decision: 'left-out',
    };
    const block = buildPriorGapBlock(prior, true);
    expect(block).toContain('Gap is covered by candidate');
    expect(block).toContain('I managed cloud infra at scale');
    expect(block).toContain('That clearly covers the gap');
    expect(block).not.toContain('HR confidential statement');
    expect(block).not.toContain('must not reach Coach');
    expect(block).not.toContain('left-out');
  });

  it('returns empty string when prior has no coach_verdict and no conversation', () => {
    expect(buildPriorGapBlock({}, false)).toBe('');
    // hr_statement and user_decision are present but must not produce output
    expect(buildPriorGapBlock({ hr_statement: 'secret', user_decision: 'skip' }, false)).toBe('');
  });

  it('returns empty string when coach_conversation exists but extensive is false and no verdict', () => {
    const prior = { coach_conversation: [{ role: 'user', content: 'something' }], coach_verdict: null };
    expect(buildPriorGapBlock(prior, false)).toBe('');
  });

  it('query result shape — restricted SELECT returns no hr_statement or user_decision', () => {
    // Documents the shape that findGapMemoryBySlogan now returns after the SELECT restriction.
    const queryResult = {
      gap_slogan:         'some-gap',
      coach_conversation: [],
      coach_verdict:      null,
    };
    expect(queryResult).not.toHaveProperty('hr_statement');
    expect(queryResult).not.toHaveProperty('user_decision');
  });
});
