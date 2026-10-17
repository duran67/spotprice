import {
  AREAS, TIME_ZONE, UnpublishedError, average, cheapestWindow, clock,
  fetchPrices, isArea, nextDate, ore, stockholmDate,
} from "./prices.js";
import type { Area, Price } from "./prices.js";

function element<T extends HTMLElement>(id: string, type: { new (...args: never[]): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing UI element: ${id}`);
  return node;
}
const text = (id: string, value: string): void => {
  element(id, HTMLElement).textContent = value;
};
const areaSelect = element("area", HTMLSelectElement);
const vatInput = element("vat", HTMLInputElement);
const durationSelect = element("duration", HTMLSelectElement);
const refreshButton = element("refresh", HTMLButtonElement);
const content = element("data-content", HTMLElement);
const status = element("status", HTMLElement);
let area: Area = "SE3";
let day: "today" | "tomorrow" = "today";
let vat = true;
let prices: Price[] = [];
let loadedAt: Date | null = null;
let request: AbortController | null = null;
let currentDate = stockholmDate(new Date());
let displayedDate = currentDate;
let loaded = false;
let selection: number | null = null;
const numberFormat = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatPrice = (sek: number): string => numberFormat.format(ore(sek, vat));
const range = (start: number, end: number, zones = false): string => `${clock(start, zones)}–${clock(end, zones)}`;

function savePreferences(): void {
  try {
    localStorage.setItem("spotprice.preferences", JSON.stringify({ area, vat }));
  } catch (error) {
    console.warn("Could not save preferences.", error);
    text("refresh-note", "Dina inställningar kunde inte sparas i webbläsaren.");
  }
}

try {
  const stored: unknown = JSON.parse(localStorage.getItem("spotprice.preferences") ?? "null");
  if (stored && typeof stored === "object") {
    if ("area" in stored && typeof stored.area === "string" && isArea(stored.area)) area = stored.area;
    if ("vat" in stored && typeof stored.vat === "boolean") vat = stored.vat;
  }
} catch (error) {
  console.warn("Could not read saved preferences.", error);
  text("refresh-note", "Sparade inställningar kunde inte läsas. Standardval används.");
}
areaSelect.value = area;
vatInput.checked = vat;

function setStatus(message: string, kind: "loading" | "error" | "empty"): void {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.textContent = message;
}

function updateHeading(): void {
  text("date-label", new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${displayedDate}T12:00:00Z`)));
  for (const value of ["today", "tomorrow"] as const) {
    const button = element(value, HTMLButtonElement);
    button.classList.toggle("active", day === value);
    button.setAttribute("aria-pressed", String(day === value));
  }
}

async function load(): Promise<void> {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), 15_000);
  currentDate = stockholmDate(new Date());
  displayedDate = day === "today" ? currentDate : nextDate(currentDate);
  const targetDate = displayedDate;
  updateHeading();
  loaded = false;
  prices = [];
  selection = null;
  content.hidden = true;
  content.setAttribute("aria-busy", "true");
  refreshButton.disabled = true;
  setStatus(`Hämtar ${day === "today" ? "dagens" : "morgondagens"} priser för ${area} · ${AREAS[area]}…`, "loading");
  try {
    const result = await fetchPrices(targetDate, area, controller.signal);
    if (request !== controller) return;
    prices = result;
    loadedAt = new Date();
    loaded = true;
    status.hidden = true;
    content.hidden = false;
    render();
  } catch (error) {
    if (request !== controller) return;
    if (error instanceof UnpublishedError && day === "tomorrow") {
      setStatus("Lite för tidigt för imorgon. Priserna är inte publicerade ännu. Prova igen senare idag.", "empty");
    } else {
      console.error("Could not load electricity prices.", error);
      const detail = controller.signal.aborted ? "Förfrågan tog för lång tid." :
        error instanceof UnpublishedError ? "Dagens priser saknas hos prisleverantören." :
        error instanceof Error ? error.message : "Ett okänt fel uppstod.";
      setStatus(`Kunde inte hämta elpriserna. ${detail} Kontrollera din anslutning och försök igen.`, "error");
    }
  } finally {
    clearTimeout(timeout);
    if (request === controller) {
      refreshButton.disabled = false;
      content.setAttribute("aria-busy", "false");
    }
  }
}

function renderPlanner(): void {
  const best = cheapestWindow(prices, Number(durationSelect.value), day === "today" ? Date.now() : -Infinity);
  if (!best) {
    text("best-time", "Ingen period kvar");
    text("best-price", "Prova en kortare tid eller välj imorgon.");
    return;
  }
  text("best-time", range(best.start, best.end, true));
  text("best-price", `${formatPrice(best.average)} öre/kWh i snitt`);
}

function render(): void {
  if (!loaded) return;
  const focusedIndex = document.activeElement?.closest(".bar-hit")?.getAttribute("data-index");
  const now = Date.now();
  const current = prices.find((price) => price.start <= now && now < price.end);
  const min = prices.reduce((a, b) => a.sek <= b.sek ? a : b);
  const max = prices.reduce((a, b) => a.sek >= b.sek ? a : b);
  const avg = average(prices);
  text("primary-label", day === "today" ? "PRISET JUST NU" : "MORGONDAGENS SNITT");
  text("primary-price", day === "today" ? current ? formatPrice(current.sek) : "—" : formatPrice(avg));
  text("primary-note", day === "today" ? current ? range(current.start, current.end, true) : "Inget aktuellt prisintervall" : "Planera morgondagens elanvändning");
  text("min-price", formatPrice(min.sek));
  text("max-price", formatPrice(max.sek));
  text("avg-price", formatPrice(avg));
  text("min-note", range(min.start, min.end, true));
  text("max-note", range(max.start, max.end, true));
  const quarterHourly = prices.every((price) => price.end - price.start === 900_000);
  text("chart-description", `${area} · ${AREAS[area]} / ${quarterHourly ? "15-minuterspriser" : "Pris per intervall"} / ${vat ? "inkl." : "exkl."} moms`);
  text("updated", `Hämtat ${clock(loadedAt!.getTime())}`);
  text("table-caption", `Spotpriser ${displayedDate}, ${area}, ${vat ? "inklusive" : "exklusive"} moms`);
  renderChart(current);
  if (focusedIndex !== null && focusedIndex !== undefined) {
    element("chart", HTMLElement).querySelector<SVGElement>(`[data-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
  }
  const rows = document.createDocumentFragment();
  for (const price of prices) {
    const row = document.createElement("tr");
    const time = document.createElement("th");
    time.scope = "row";
    time.textContent = range(price.start, price.end, true);
    const value = document.createElement("td");
    value.textContent = formatPrice(price.sek);
    row.append(time, value);
    rows.append(row);
  }
  element("price-rows", HTMLElement).replaceChildren(rows);
  renderPlanner();
}

function renderChart(current: Price | undefined): void {
  const host = element("chart", HTMLElement);
  const width = Math.max(260, host.clientWidth);
  const compact = width < 600;
  const height = compact ? 220 : 260;
  const left = compact ? 37 : 54;
  const right = 15;
  const top = 16;
  const bottom = height - 34;
  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  const values = prices.map((price) => ore(price.sek, vat));
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const lower = low < 0 ? low - span * 0.12 : 0;
  const upper = high + span * 0.15 || 1;
  const y = (value: number): number => bottom - (value - lower) / (upper - lower) * (bottom - top);
  const x = (value: number): number => left + (value - first.start) / (last.end - first.start) * (width - left - right);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `Elprisdiagram för ${area}. Använd piltangenterna för att välja intervall, eller öppna pristabellen.`);
  function shape(name: string, attrs: Record<string, string>, label?: string): SVGElement {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (label !== undefined) node.textContent = label;
    svg.append(node);
    return node;
  }
  for (let i = 0; i <= 4; i++) {
    const value = lower + (upper - lower) * i / 4;
    const lineY = y(value);
    shape("line", { x1: String(left), x2: String(width - right), y1: String(lineY), y2: String(lineY), class: "grid-line" });
    shape("text", { x: String(left - 12), y: String(lineY + 4), "text-anchor": "end", class: "axis-label" }, numberFormat.format(value));
  }
  shape("line", { x1: String(left), x2: String(width - right), y1: String(y(0)), y2: String(y(0)), class: "zero-line" });
  const selectedIndex = selection ?? Math.max(0, prices.indexOf(current ?? first));
  prices.forEach((price, index) => {
    const value = values[index]!;
    const startX = x(price.start);
    const barWidth = x(price.end) - startX;
    const gap = compact ? 0.5 : 2;
    shape("rect", {
      x: String(startX + gap / 2), y: String(Math.min(y(value), y(0))),
      width: String(Math.max(1, barWidth - gap)), height: String(Math.max(1.5, Math.abs(y(value) - y(0)))),
      rx: "2", class: `price-bar${price === current ? " is-current" : ""}${value < 0 ? " is-negative" : ""}`,
      "aria-hidden": "true",
    });
    const label = `${range(price.start, price.end, true)}: ${formatPrice(price.sek)} öre/kWh`;
    const hit = shape("rect", {
      x: String(startX), y: String(top), width: String(barWidth), height: String(bottom - top),
      fill: "transparent", class: "bar-hit", tabindex: index === selectedIndex ? "0" : "-1",
      role: "button", "aria-label": label, "data-index": String(index),
    });
    function select(): void {
      selection = index;
      text("chart-selection", label);
      host.querySelectorAll(".bar-hit").forEach((bar) => bar.setAttribute("tabindex", bar === hit ? "0" : "-1"));
    }
    hit.addEventListener("pointerenter", select);
    hit.addEventListener("focus", select);
    hit.addEventListener("click", select);
    hit.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      let target = index;
      if (event.key === "ArrowRight") target = Math.min(prices.length - 1, index + 1);
      else if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = prices.length - 1;
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); return; }
      else return;
      event.preventDefault();
      host.querySelector<SVGElement>(`[data-index="${target}"]`)?.focus();
    });
  });
  for (let timestamp = first.start; timestamp < last.end; timestamp += 3_600_000) {
    if (Number(clock(timestamp).slice(0, 2)) % (compact ? 6 : 3) === 0) {
      shape("text", { x: String(x(timestamp)), y: String(height - 9), "text-anchor": "middle", class: "axis-label" }, clock(timestamp));
    }
  }
  shape("text", { x: String(x(last.end)), y: String(height - 9), "text-anchor": "end", class: "axis-label" }, "24:00");
  host.replaceChildren(svg);
  text("chart-selection", selection === null ? "Peka på en stapel för att se priset" :
    `${range(prices[selection]!.start, prices[selection]!.end, true)}: ${formatPrice(prices[selection]!.sek)} öre/kWh`);
}

areaSelect.addEventListener("change", () => {
  if (!isArea(areaSelect.value)) throw new Error("Invalid area selected.");
  area = areaSelect.value;
  savePreferences();
  void load();
});
vatInput.addEventListener("change", () => { vat = vatInput.checked; savePreferences(); render(); });
durationSelect.addEventListener("change", () => { if (loaded) renderPlanner(); });
for (const value of ["today", "tomorrow"] as const) {
  element(value, HTMLButtonElement).addEventListener("click", () => {
    if (day === value) return;
    day = value;
    void load();
  });
}
refreshButton.addEventListener("click", () => { void load(); });
window.addEventListener("resize", () => { if (loaded) render(); });
setInterval(() => {
  if (stockholmDate(new Date()) !== currentDate) void load();
  else if (loaded) render();
}, 30_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!loadedAt || Date.now() - loadedAt.getTime() > 15 * 60_000)) void load();
});
void load();
