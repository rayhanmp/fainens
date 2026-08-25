function addMonthsClamped(ms: number, months: number): number {
  const source = new Date(ms);
  const day = source.getDate();
  const target = new Date(ms);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(
    target.getFullYear(), target.getMonth() + 1, 0,
    source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds(),
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

export function addOneMonth(ms: number): number {
  return addMonthsClamped(ms, 1);
}

export function addOneYear(ms: number): number {
  return addMonthsClamped(ms, 12);
}

export function monthlyOccurrenceDate(year: number, zeroBasedMonth: number, requestedDay: number): number {
  const lastDay = new Date(year, zeroBasedMonth + 1, 0, 12, 0, 0, 0).getDate();
  return new Date(year, zeroBasedMonth, Math.min(Math.max(requestedDay, 1), lastDay), 12, 0, 0, 0).getTime();
}
