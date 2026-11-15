# RIFTBOUND Card Library and Collection

Vite, React, and TypeScript application for browsing Riftbound cards, tracking owned quantities, and comparing pasted deck lists. Card printings and metadata are loaded from OpenRift; collection quantities and theme preferences are stored in browser localStorage.

## Run locally

Requires Node.js 20+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The development and preview servers proxy `/api/openrift/*` to `https://openrift.app/api/v1/*`. The catalog request asks for both English and Korean printings. The browser-side catalog cache and proxy response cache use a one-hour window.

The legacy Riftcodex provider and proxy remain only to migrate saved collection quantities. On the first successful OpenRift load, old provider IDs are mapped by card code. Unmatched values remain in localStorage.

## Live site

https://chaemyoungjae-wq.github.io/riftbound-deck-checker/ — deployed by `.github/workflows/deploy.yml` on every push to `main`. The static build calls the OpenRift and Riftcodex APIs directly (both allow cross-origin requests), so no proxy server is needed.

## Build

```sh
pnpm build
```

## Data and attribution

OpenRift is a community project and is not affiliated with Riot Games. This application reads card data and image URLs from OpenRift; it does not bundle the catalog or download card images into the project. Check Riot Games and asset-provider policies before public redistribution.
