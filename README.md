# spotpris

A Swedish electricity spot-price dashboard built with TypeScript, plain HTML,
and CSS. No UI frameworks, chart libraries, bundler, or runtime dependencies.

## Run locally

Requires **Node.js 24+** and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. `npm run dev` builds and starts a local-only static
server. After editing, rebuild with `npm run build` and reload the browser.
Use `PORT=8080 npm start` to select another port.

```sh
npm run check
npm test
npm run build
```

The generated `dist/` directory can also be published to any static web host.
No credentials or backend are needed. The browser needs access to the price API.

## Deploy to Cloudflare

### Workers (Git integration)

The included `wrangler.json` configures a static-assets-only Worker and uploads
only `dist/`, not the repository or `node_modules/`.

In your Worker's build settings, use:

- Root directory: the repository root.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy` (remove any `--assets .` override).
- Build environment variable: `NODE_VERSION=24`.

If Cloudflare reports that the Worker name does not match, change `name` in
`wrangler.json` to the name of your existing Cloudflare Worker. This deployment
identifier does not change the visible `spotpris` branding.

Push these files to the connected GitHub branch and redeploy. Do not use the
repository root as the assets directory: it includes development dependencies
that are not part of the website and may exceed Cloudflare's asset size limit.

### Pages (alternative)

For a Cloudflare Pages project, choose no framework preset, set the build command
to `npm run build`, the build output directory to `dist`, and the build
environment variable `NODE_VERSION=24`. Pages does not need a Wrangler deploy
command.

## Features and data

- SE1–SE4, today and tomorrow, and a persistent area/VAT preference.
- Prices in öre/kWh, optionally including 25% VAT.
- Actual interval bars, current price, daily extremes, and duration-weighted average.
- Cheapest consecutive 1–4 hours within the selected day. Today's search only
  includes intervals starting at or after the current instant; a period already
  underway is not recommended. Windows can span multiple intervals and use a
  partial final interval when necessary.
- Accessible price table, keyboard-navigable chart (arrows, Home, End),
  responsive layout, loading/error/unpublished states, and manual refresh.
- Stockholm-local dates and times, including 23/25-hour daylight-saving days.
  Timezone abbreviations distinguish repeated autumn clock times.
- Current interval and remaining-day recommendations update every 30 seconds.
  The selected relative day reloads at Stockholm midnight; returning to a tab
  after 15 minutes triggers a refresh.

Data comes directly from the public
[Elpriset just nu API](https://www.elprisetjustnu.se/elpris-api), not a scraped
Nord Pool page. The provider describes the API as open and free to use, and
requests attribution for public use; a source link is included in the dashboard.
Check the provider's current terms and service availability before a commercial
launch. No fabricated prices or silent demo fallback are used.

The app accepts complete, contiguous daily series, including hourly and
15-minute data. Tomorrow's HTTP 404 means prices have not yet been published;
other errors are shown explicitly. Requests time out after 15 seconds and
superseded requests cannot overwrite the current selection.

Spot prices are not total household electricity costs. Retailer markups,
energy tax, and grid charges are excluded. Whether a household benefits from
moving consumption depends on its electricity contract.
