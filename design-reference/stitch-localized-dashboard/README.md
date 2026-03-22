# Stitch: Localized Dashboard

Fetched from **Google Stitch** via MCP (`user-stitch` → `get_screen`).

| Field | Value |
|--------|--------|
| **Project** | Bookkeeping Dashboard (ID `12603509304854076953`) |
| **Screen** | Localized Dashboard (ID `67ee3fdedb9246efb79785b8adcbc0e7`) |
| **Device** | Desktop (2560×2704) |

## Files

| File | Description |
|------|-------------|
| `localized-dashboard-screenshot.png` | Screen capture from Stitch CDN |
| `localized-dashboard.html` | Exported HTML/CSS from Stitch |

## Re-download (curl)

URLs expire; re-fetch with Stitch MCP `get_screen` and replace the links below.

```bash
# Screenshot (replace URL from MCP response)
curl -L -o localized-dashboard-screenshot.png "<screenshot.downloadUrl>"

# HTML (replace URL from MCP response)
curl -L -o localized-dashboard.html "<htmlCode.downloadUrl>"
```

Use this folder as **visual/code reference** when aligning the Fainens dashboard UI.

**Implemented in app:** global tokens in [`frontend/src/index.css`](../../frontend/src/index.css) (`--ref-*`, Manrope + Inter, editorial shadow) and the home route [`frontend/src/routes/index.tsx`](../../frontend/src/routes/index.tsx) (bento stats, table, right-column breakdown + budgets).
