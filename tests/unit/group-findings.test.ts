import { describe, expect, it } from 'vitest';
import { groupFindings, type Finding } from '@releasecheck/contracts';

const http = (url = 'http://127.0.0.1:4174/missing', method = 'GET'): Finding => ({
  kind: 'http',
  message: 'HTTP 404',
  url,
  request: { method, resourceType: 'fetch', status: 404 },
});
const consoleError = (url = 'http://127.0.0.1:4174/missing'): Finding => ({
  kind: 'console',
  message: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
  source: { url, line: 1, column: 1 },
});

describe('Lossless observation grouping', () => {
  it('links resource errors regardless of event order and retains original evidence', () => {
    const findings = [consoleError(), http(), consoleError(), http()];
    const original = structuredClone(findings);
    const groups = groupFindings(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'http', relation: 'resource' });
    expect(groups[0]!.observations.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(groups[0]!.observations.map((item) => item.finding)).toEqual(findings);
    expect(findings).toEqual(original);
  });
  it('preserves ambiguous methods, mismatched statuses and query strings', () => {
    expect(groupFindings([http(), http(undefined, 'POST'), consoleError()])).toHaveLength(3);
    expect(
      groupFindings([
        http(),
        {
          ...consoleError(),
          message: 'Failed to load resource: the server responded with a status of 500 (Error)',
        },
      ]),
    ).toHaveLength(2);
    expect(
      groupFindings([
        http('http://127.0.0.1:4174/missing?a=1'),
        consoleError('http://127.0.0.1:4174/missing?a=2'),
      ]),
    ).toHaveLength(2);
  });
  it('does not infer identity from generic text, legacy or truncated context', () => {
    expect(
      groupFindings([http(), { kind: 'console', message: consoleError().message }]),
    ).toHaveLength(2);
    expect(
      groupFindings([http(), { ...consoleError(), message: 'HTTP 404: application state failed' }]),
    ).toHaveLength(2);
    const truncated = 'http://127.0.0.1/' + 'x'.repeat(2048);
    expect(groupFindings([http(truncated), consoleError(truncated)])).toHaveLength(2);
    expect(
      groupFindings([{ kind: 'http', message: 'HTTP 404', url: http().url! }, consoleError()]),
    ).toHaveLength(2);
  });
  it('groups exact repeats without merging distinct locations or stacks', () => {
    const error: Finding = {
      kind: 'javascript',
      message: 'Cart unavailable',
      stack: 'at cart.js:1:1',
    };
    const groups = groupFindings([error, error, { ...error, stack: 'at cart.js:2:1' }]);
    expect(groups.map((group) => group.observations.length)).toEqual([2, 1]);
    expect(
      groupFindings([
        consoleError(),
        { ...consoleError(), source: { url: 'http://127.0.0.1:4174/missing', line: 2 } },
      ]),
    ).toHaveLength(2);
  });
  it('covers every observation once and keeps unrelated errors and the truncation marker visible', () => {
    const findings: Finding[] = [
      http(),
      consoleError(),
      { kind: 'transport', message: 'net::ERR_FAILED', url: http().url! },
      { kind: 'console', message: 'Observation limit reached; additional findings were omitted.' },
      { kind: 'javascript', message: 'Different failure' },
    ];
    const groups = groupFindings(findings);
    expect(groups).toHaveLength(4);
    expect(groups.flatMap((group) => group.observations.map((item) => item.index)).sort()).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(groupFindings([])).toEqual([]);
  });
});
