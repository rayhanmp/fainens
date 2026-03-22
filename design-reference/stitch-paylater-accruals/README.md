# Stitch — PayLater & Accruals

Reference export for **Bookkeeping Dashboard** (project `12603509304854076953`), screen **PayLater & Accruals** (`dd3f15f7ac7a49b99975459a36288db4`).

## Files

- `paylater-accruals.html` — layout markup (Tailwind CDN)
- `paylater-accruals.png` — screenshot

## Fetching (MCP + curl)

Use the Stitch MCP **get_screen** (or equivalent) with `projectId` + `screenId` to obtain hosted URLs, then download:

```bash
curl -L -o paylater-accruals.html "<HTML_URL>"
curl -L -o paylater-accruals.png "<SCREENSHOT_URL>"
```

The app’s PayLater UI (`frontend/src/routes/paylater.tsx`) follows this structure: liability header, total outstanding, **Payment schedule** calendar, **Provider exposure** list, and **Individual accruals** table with per-obligation actions.
