import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UnpublishedError, average, cheapestWindow, clock, fetchPrices, isArea,
  nextDate, ore, parsePrices, stockholmDate,
} from "../src/prices.ts";
import type { Price } from "../src/prices.ts";

const HOUR = 3_600_000;
const price = (start: number, end: number, sek: number): Price => ({ start, end, sek });

function dayData(start: string, count: number, minutes = 15): unknown[] {
  const first = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({
    SEK_per_kWh: i % 2 ? -0.25 : 0.5,
    time_start: new Date(first + i * minutes * 60_000).toISOString(),
    time_end: new Date(first + (i + 1) * minutes * 60_000).toISOString(),
  }));
}

test("Swedish dates do not depend on the machine timezone", () => {
  assert.equal(stockholmDate(new Date("2026-10-16T22:30:00Z")), "2026-10-17");
  assert.equal(stockholmDate(new Date("2026-01-01T23:30:00Z")), "2026-01-02");
  assert.equal(nextDate("2026-12-31"), "2027-01-01");
  assert.equal(nextDate("2028-02-28"), "2028-02-29");
  assert.equal(clock(Date.parse("2026-10-17T10:00:00Z")), "12:00");
  assert.equal(isArea("SE3"), true);
  assert.equal(isArea("toString"), false);
  assert.equal(isArea("SE5"), false);
});

test("conversion includes optional VAT and preserves negative and zero prices", () => {
  assert.equal(ore(1, false), 100);
  assert.equal(ore(1, true), 125);
  assert.equal(ore(-0.2, true), -25);
  assert.equal(ore(0, true), 0);
});

test("daily average is weighted by elapsed time", () => {
  assert.equal(average([price(0, HOUR, 1), price(HOUR, HOUR * 4, 3)]), 2.5);
  assert.throws(() => average([]), /empty/);
});

test("normal, hourly, spring-forward, and fall-back days are accepted", () => {
  assert.equal(parsePrices(dayData("2026-10-17T00:00:00+02:00", 96), "2026-10-17").length, 96);
  assert.equal(parsePrices(dayData("2026-10-17T00:00:00+02:00", 24, 60), "2026-10-17").length, 24);
  assert.equal(parsePrices(dayData("2026-03-29T00:00:00+01:00", 92), "2026-03-29").length, 92);
  assert.equal(parsePrices(dayData("2026-10-25T00:00:00+02:00", 100), "2026-10-25").length, 100);
  const firstTwo = Date.parse("2026-10-25T02:00:00+02:00");
  const secondTwo = Date.parse("2026-10-25T02:00:00+01:00");
  assert.notEqual(clock(firstTwo, true), clock(secondTwo, true));
});

test("invalid, partial, gapped, overlapping, and wrong-day data is rejected", () => {
  const valid = dayData("2026-10-17T00:00:00+02:00", 96);
  assert.throws(() => parsePrices([], "2026-10-17"));
  assert.throws(() => parsePrices({}, "2026-10-17"));
  assert.throws(() => parsePrices([{ SEK_per_kWh: "1" }], "2026-10-17"));
  assert.throws(() => parsePrices([{ SEK_per_kWh: Infinity }], "2026-10-17"));
  assert.throws(() => parsePrices(valid.slice(1), "2026-10-17"), /komplett/);
  assert.throws(() => parsePrices(valid.slice(0, -1), "2026-10-17"), /komplett/);
  assert.throws(() => parsePrices([...valid.slice(0, 3), ...valid.slice(4)], "2026-10-17"), /luckor/);
  assert.throws(() => parsePrices([...valid, valid[0]], "2026-10-17"), /överlappande/);
  assert.throws(() => parsePrices(valid, "2026-10-18"), /tidsstämplar/);
  assert.equal(parsePrices([...valid].reverse(), "2026-10-17").length, 96);
});

test("cheapest window uses consecutive intervals, not individually cheapest prices", () => {
  const prices = [price(0, HOUR, 0), price(HOUR, HOUR * 2, 10), price(HOUR * 2, HOUR * 3, 2), price(HOUR * 3, HOUR * 4, 2)];
  assert.deepEqual(cheapestWindow(prices, 2), { start: HOUR * 2, end: HOUR * 4, average: 2 });
  assert.deepEqual(cheapestWindow(prices, 1), { start: 0, end: HOUR, average: 0 });
});

test("today excludes started intervals, too-short windows, and day overflow", () => {
  const prices = [price(0, HOUR, -1), price(HOUR, HOUR * 2, 2), price(HOUR * 2, HOUR * 3, 3)];
  assert.deepEqual(cheapestWindow(prices, 2, 1), { start: HOUR, end: HOUR * 3, average: 2.5 });
  assert.equal(cheapestWindow(prices, 2, HOUR + 1), null);
  assert.equal(cheapestWindow(prices, 4), null);
  assert.equal(cheapestWindow([], 2), null);
  assert.throws(() => cheapestWindow(prices, 0), /positive/);
});

test("window integrates partial final intervals and handles negative prices and ties", () => {
  const prices = [price(0, HOUR, -2), price(HOUR, 3 * HOUR, 2)];
  assert.deepEqual(cheapestWindow(prices, 2), { start: 0, end: 2 * HOUR, average: 0 });
  assert.deepEqual(cheapestWindow([price(0, HOUR, -1), price(HOUR, 2 * HOUR, -1)], 1),
    { start: 0, end: HOUR, average: -1 });
  assert.equal(cheapestWindow([price(0, HOUR, 1), price(2 * HOUR, 3 * HOUR, 1)], 2), null);
});

test("two-hour windows remain two elapsed hours across DST changes", () => {
  const prices = parsePrices(dayData("2026-10-25T00:00:00+02:00", 100), "2026-10-25");
  const best = cheapestWindow(prices, 2, Date.parse("2026-10-25T02:00:00+02:00"))!;
  assert.equal(best.end - best.start, 2 * HOUR);
});

test("API URL, 404, HTTP failures, malformed JSON, and cancellation are explicit", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://www.elprisetjustnu.se/api/v1/prices/2026/10-17_SE3.json");
    assert.ok(init?.signal);
    return new Response(JSON.stringify(dayData("2026-10-17T00:00:00+02:00", 96)));
  };
  assert.equal((await fetchPrices("2026-10-17", "SE3", new AbortController().signal)).length, 96);
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(fetchPrices("2026-10-17", "SE3", new AbortController().signal), UnpublishedError);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(fetchPrices("2026-10-17", "SE3", new AbortController().signal), /HTTP 503/);
  globalThis.fetch = async () => new Response("not json");
  await assert.rejects(fetchPrices("2026-10-17", "SE3", new AbortController().signal), SyntaxError);
  globalThis.fetch = async () => { throw new DOMException("Aborted", "AbortError"); };
  await assert.rejects(fetchPrices("2026-10-17", "SE3", new AbortController().signal), /Aborted/);
});
