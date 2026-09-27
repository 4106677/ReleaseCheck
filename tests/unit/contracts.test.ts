import { describe, expect, it } from 'vitest';
import { createRunSchema, idempotencyKeySchema, isTerminal } from '@releasecheck/contracts';
import { localFixtureOrigin, captureInputSchema } from '@releasecheck/checks';

describe('local capture boundary', () => {
  it('accepts only predefined fixture variants, never a user-supplied URL', () => {
    expect(createRunSchema.parse({})).toEqual({ variant: 'baseline', viewport: 'desktop' });
    expect(
      createRunSchema.safeParse({ variant: 'regression', url: 'http://internal/' }).success,
    ).toBe(false);
    expect(createRunSchema.safeParse({ variant: 'custom' }).success).toBe(false);
  });
  it.each([
    'https://example.com',
    'http://127.0.0.1:4174/path',
    'http://localhost:4174',
    'http://user:pass@127.0.0.1:4174',
    'http://127.0.0.1:4174?url=other',
  ])('rejects unsupported fixture origin %s', (origin) => {
    expect(() => localFixtureOrigin(origin)).toThrow();
  });
  it('normalizes the explicitly configured loopback fixture', () => {
    expect(localFixtureOrigin('http://127.0.0.1:4174/')).toBe('http://127.0.0.1:4174');
  });
  it('rejects blank and oversized idempotency keys', () => {
    expect(idempotencyKeySchema.safeParse('').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('request-1234').success).toBe(true);
  });
  it('keeps polling until a terminal state', () => {
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('failed')).toBe(true);
  });
});

it('allows only the two bounded capture sizes and rejects mixed dimensions', () => {
  expect(createRunSchema.safeParse({ viewport: 'tablet' }).success).toBe(false);
  const input = { url: 'http://127.0.0.1:4174/', fixtureOrigin: 'http://127.0.0.1:4174' };
  expect(captureInputSchema.safeParse({ ...input, width: 390, height: 844 }).success).toBe(true);
  expect(captureInputSchema.safeParse({ ...input, width: 390, height: 900 }).success).toBe(false);
  expect(captureInputSchema.safeParse({ ...input, width: 10000, height: 10000 }).success).toBe(
    false,
  );
});
