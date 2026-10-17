export const TIME_ZONE = "Europe/Stockholm";
export const AREAS = {
  SE1: "Luleå",
  SE2: "Sundsvall",
  SE3: "Stockholm",
  SE4: "Malmö",
} as const;
export type Area = keyof typeof AREAS;
export interface Price {
  start: number;
  end: number;
  sek: number;
}
export interface PriceWindow {
  start: number;
  end: number;
  average: number;
}
export class UnpublishedError extends Error {}

export function isArea(value: string): value is Area {
  return Object.hasOwn(AREAS, value);
}

export function stockholmDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function clock(timestamp: number, withZone = false): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit",
    ...(withZone ? { timeZoneName: "short" } : {}),
  }).format(timestamp);
}

export function ore(sek: number, vat: boolean): number {
  return sek * 100 * (vat ? 1.25 : 1);
}

export function average(prices: readonly Price[]): number {
  if (!prices.length) throw new Error("Cannot average an empty price series.");
  const duration = prices.reduce((sum, price) => sum + price.end - price.start, 0);
  return prices.reduce((sum, price) => sum + price.sek * (price.end - price.start), 0) / duration;
}

export function cheapestWindow(
  prices: readonly Price[], hours: number, notBefore = -Infinity,
): PriceWindow | null {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("Duration must be positive.");
  const duration = hours * 3_600_000;
  let best: PriceWindow | null = null;
  for (let i = 0; i < prices.length; i++) {
    const first = prices[i]!;
    if (first.start < notBefore) continue;
    const end = first.start + duration;
    let cursor = first.start;
    let total = 0;
    for (let j = i; j < prices.length && cursor < end; j++) {
      const price = prices[j]!;
      if (price.start !== cursor) break;
      const usedEnd = Math.min(end, price.end);
      total += price.sek * (usedEnd - cursor);
      cursor = usedEnd;
    }
    if (cursor === end && (!best || total / duration < best.average)) {
      best = { start: first.start, end, average: total / duration };
    }
  }
  return best;
}

export function parsePrices(value: unknown, date: string): Price[] {
  if (!Array.isArray(value) || !value.length) throw new Error("Prisleverantören skickade tomma eller ogiltiga data.");
  const prices = value.map((item: unknown): Price => {
    if (typeof item !== "object" || item === null ||
        !("SEK_per_kWh" in item) || typeof item.SEK_per_kWh !== "number" ||
        !Number.isFinite(item.SEK_per_kWh) ||
        !("time_start" in item) || typeof item.time_start !== "string" ||
        !("time_end" in item) || typeof item.time_end !== "string") {
      throw new Error("Prisleverantören skickade ett ogiltigt prisintervall.");
    }
    const start = Date.parse(item.time_start);
    const end = Date.parse(item.time_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        stockholmDate(new Date(start)) !== date) {
      throw new Error("Prisleverantören skickade ogiltiga tidsstämplar.");
    }
    return { start, end, sek: item.SEK_per_kWh };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < prices.length; i++) {
    if (prices[i]!.start !== prices[i - 1]!.end) {
      throw new Error("Prisdata har luckor eller överlappande intervall.");
    }
  }
  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  if (clock(first.start) !== "00:00" || clock(last.end) !== "00:00" ||
      stockholmDate(new Date(last.end)) !== nextDate(date)) {
    throw new Error("Prisleverantören skickade inte ett komplett dygn.");
  }
  return prices;
}

export async function fetchPrices(date: string, area: Area, signal: AbortSignal): Promise<Price[]> {
  const response = await fetch(
    `https://www.elprisetjustnu.se/api/v1/prices/${date.slice(0, 4)}/${date.slice(5)}_${area}.json`,
    { signal },
  );
  if (response.status === 404) throw new UnpublishedError("Priserna är inte publicerade ännu.");
  if (!response.ok) throw new Error(`Prisleverantören svarade med HTTP ${response.status}.`);
  return parsePrices(await response.json(), date);
}
