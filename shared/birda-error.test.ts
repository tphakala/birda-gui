import { describe, expect, it } from 'vitest';
import { describeBirdaFailure, rangeFilterDisabledReason, speciesFetchProblem, stripAnsi } from './birda-error';

const ESC = String.fromCharCode(27);

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m plain`)).toBe('red plain');
  });
});

describe('describeBirdaFailure', () => {
  it('takes the last error: line from ANSI stderr and strips the IPC prefix', () => {
    const msg =
      "Error invoking remote method 'birda:analyze': Error: Analysis failed: birda exited with code 1\n" +
      `${ESC}[2m2026-05-15T05:30:00Z${ESC}[0m ${ESC}[32m INFO${ESC}[0m birda: starting\n` +
      `${ESC}[31merror:${ESC}[0m first problem\n` +
      `error: model file missing`;
    const r = describeBirdaFailure(msg);
    expect(r.headline).toBe('model file missing');
    expect(r.details).not.toContain(ESC);
    expect(r.details).not.toContain('Error invoking remote method');
    expect(r.details).toContain('first problem');
  });

  it('falls back to the last tracing ERROR line', () => {
    const r = describeBirdaFailure('Analysis failed\n2026-05-15T05:30:00Z  ERROR birda::run: could not open device');
    expect(r.headline).toBe('could not open device');
  });

  it('falls back to the first line and has no details for one line', () => {
    expect(describeBirdaFailure('Analysis failed: birda exited with code 1')).toEqual({
      headline: 'Analysis failed: birda exited with code 1',
      details: null,
    });
  });
});

describe('rangeFilterDisabledReason', () => {
  it('matches both birda 1.8.1 messages', () => {
    expect(
      rangeFilterDisabledReason("2026 WARN birda: Range filtering disabled for model 'x': no meta model configured"),
    ).toBe('no meta model configured');
    expect(rangeFilterDisabledReason('WARN Range filtering disabled: no labels found for meta model')).toBe(
      'no labels found for meta model',
    );
    expect(rangeFilterDisabledReason('INFO something else')).toBeNull();
  });
});

describe('speciesFetchProblem', () => {
  it('classifies known failures', () => {
    expect(speciesFetchProblem('configuration validation failed: no model specified')).toBe('no_model');
    expect(speciesFetchProblem('range filtering requires meta model')).toBe('no_range_model');
    expect(speciesFetchProblem("model 'a' has no meta model")).toBe('no_range_model');
    expect(speciesFetchProblem('no installed model has a range filter')).toBe('no_range_model');
    expect(speciesFetchProblem('network down')).toBeNull();
  });
});
