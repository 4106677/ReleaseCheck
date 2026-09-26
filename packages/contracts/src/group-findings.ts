import type { Finding } from './index.js';

export interface FindingGroup {
  id: string;
  kind: Finding['kind'];
  message: string;
  relation: 'identical' | 'resource';
  observations: { index: number; finding: Finding }[];
}

const fingerprint = (finding: Finding) =>
  JSON.stringify([
    finding.kind,
    finding.message,
    finding.url ?? null,
    finding.source?.url ?? null,
    finding.source?.line ?? null,
    finding.source?.column ?? null,
    finding.request?.method ?? null,
    finding.request?.resourceType ?? null,
    finding.request?.status ?? null,
    finding.stack ?? null,
  ]);

const fullUrl = (value: string | undefined) => {
  if (!value || value.length >= 2048) return null; // Truncated URLs cannot establish identity.
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
};

/** Presentation only. Every input observation appears once, unchanged, in the output. */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  const exact = new Map<string, FindingGroup>();
  findings.forEach((finding, index) => {
    const key = fingerprint(finding);
    const existing = exact.get(key);
    if (existing) existing.observations.push({ index, finding });
    else
      exact.set(key, {
        id: `observation-${index}`,
        kind: finding.kind,
        message: finding.message,
        relation: 'identical',
        observations: [{ index, finding }],
      });
  });
  const groups = [...exact.values()];
  const linked = new Set<FindingGroup>();
  for (const group of groups) {
    const finding = group.observations[0]!.finding;
    if (finding.kind !== 'console') continue;
    // Only Chromium's specific HTTP failure message with an exact resource URL
    // and status is eligible. Arbitrary console errors and legacy data stay separate.
    const status =
      /^Failed to load resource: the server responded with a status of (\d{3})(?: \([^)]*\))?$/.exec(
        finding.message,
      )?.[1];
    const url = fullUrl(finding.source?.url);
    if (!status || !url) continue;
    const candidates = groups.filter((candidate) => {
      const other = candidate.observations[0]!.finding;
      return (
        other.kind === 'http' &&
        fullUrl(other.url) === url &&
        other.request?.status === Number(status) &&
        !!other.request.method
      );
    });
    if (candidates.length !== 1) continue; // Multiple methods/contexts are ambiguous.
    const target = candidates[0]!;
    target.relation = 'resource';
    target.observations.push(...group.observations);
    linked.add(group);
  }
  return groups
    .filter((group) => !linked.has(group))
    .map((group) => ({
      ...group,
      observations: [...group.observations].sort((a, b) => a.index - b.index),
    }))
    .sort((a, b) => a.observations[0]!.index - b.observations[0]!.index);
}
