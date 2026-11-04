export const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
export function gradeTotals(rows, osce = {}) {
  const expected = rows.filter(r => r.included);
  const received = expected.filter(r => !r.selectionChanged && r.record?.pairing_status === 'paired' && validScore(r.record.score));
  const average = expected.length && received.length === expected.length && rows.every(r => r.unit)
    ? received.reduce((sum, r) => sum + r.record.score, 0) / expected.length : null;
  const osceAverage = validScore(osce.suture) && validScore(osce.dressing) ? (osce.suture + osce.dressing) / 2 : null;
  const physicianWeighted = average === null ? null : average * 0.8;
  const osceWeighted = osceAverage === null ? null : osceAverage * 0.2;
  const subtotal = physicianWeighted === null || osceWeighted === null ? null : physicianWeighted + osceWeighted;
  const passportDeduction = validScore(osce.passport_completion) ? (osce.passport_completion < 90 ? 10 : 0) : null;
  return {expected: expected.length, received: received.length, average, physicianWeighted, osceAverage, osceWeighted,
    subtotal, passportDeduction, finalScore: subtotal === null || passportDeduction === null ? null : subtotal - passportDeduction};
}
// Scope scores to the complete student's batch, never to the current month filter.
export function studentCohorts(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = JSON.stringify([row.studentId, row.batch]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  return [...groups.values()].map(items => {
    const start = items.map(r => r.start).sort()[0];
    const end = items.map(r => r.end).sort().at(-1);
    const row = items[0];
    return {id: JSON.stringify([row.studentId, row.batch, start, end]), row, rows: items, start, end};
  });
}
