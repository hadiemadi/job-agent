'use strict';

// Unit tests for buildProfileBlock (services/profileBlock.js) covering the common cases
// a Coach or HR system prompt will encounter: empty profile, partial categories, full profile.

jest.mock('../core/claude',    () => ({ client: {}, MODEL: 'test-model' }));
jest.mock('../core/json',      () => ({ extractJSON: jest.fn(), firstText: jest.fn() }));
jest.mock('../core/logger',    () => ({ logDiagnostic: jest.fn() }));
jest.mock('../core/knowledge', () => ({ loadCore: jest.fn().mockReturnValue('Coach persona') }));
jest.mock('../core/preferences', () => ({ preferencesBlock: jest.fn().mockReturnValue('') }));
jest.mock('./recruiter',        () => ({ fieldBlock: jest.fn().mockReturnValue('') }));

const { buildProfileBlock } = require('../services/profileBlock');

describe('buildProfileBlock', () => {
  it('returns empty string for null profile', () => {
    expect(buildProfileBlock(null)).toBe('');
  });

  it('returns empty string for profile with no categories key', () => {
    expect(buildProfileBlock({})).toBe('');
    expect(buildProfileBlock({ version: 1 })).toBe('');
  });

  it('returns empty string when all categories are empty arrays', () => {
    const profile = { categories: { TechnicalSkills: [], Certifications: [] } };
    expect(buildProfileBlock(profile)).toBe('');
  });

  it('renders populated categories as a labelled block', () => {
    const profile = {
      categories: {
        TechnicalSkills: ['RF antenna design (3+ years)', 'MATLAB signal processing'],
        Certifications: ['PMP 2022'],
        Experience: [],
      },
    };
    const block = buildProfileBlock(profile);
    expect(block).toContain('CANDIDATE PROFILE — additional background');
    expect(block).toContain('actively decide which profile facts');
    expect(block).toContain('TechnicalSkills: RF antenna design (3+ years) | MATLAB signal processing');
    expect(block).toContain('Certifications: PMP 2022');
    expect(block).not.toContain('Experience:');
  });

  it('excludes categories with empty arrays', () => {
    const profile = {
      categories: {
        Leadership: [],
        Projects: ['5G rollout — 3 sites, $2M budget'],
      },
    };
    const block = buildProfileBlock(profile);
    expect(block).not.toContain('Leadership');
    expect(block).toContain('Projects: 5G rollout — 3 sites, $2M budget');
  });
});
