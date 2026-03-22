# Stitch: Financial Command Center (Manual Ledger)

Fetched from **Google Stitch** via MCP (`user-stitch` → `get_screen`).

| Field | Value |
|--------|--------|
| **Project** | Bookkeeping Dashboard (ID `12603509304854076953`) |
| **Screen** | Financial Command Center (Manual Ledger) (ID `ce22202486da46fab7ded020a5cf719d`) |
| **Device** | Desktop (2560×2048) |

## Files

| File | Description |
|------|-------------|
| `financial-command-center.png` | Screen capture from Stitch (CDN) |
| `financial-command-center.html` | Exported HTML/CSS from Stitch |

## Re-download (`curl`)

Hosted URLs **expire**. Refresh files by calling Stitch MCP `get_screen` with the project + screen IDs above, then run:

```bash
cd design-reference/stitch-financial-command-center

# Replace URLs from the MCP response (screenshot.downloadUrl, htmlCode.downloadUrl)
curl -L -o financial-command-center.png "<screenshot.downloadUrl>"
curl -L -o financial-command-center.html "<htmlCode.downloadUrl>"
```

**One-liner from Cursor:** use MCP **user-stitch** → **get_screen** with:

```json
{
  "projectId": "12603509304854076953",
  "screenId": "ce22202486da46fab7ded020a5cf719d"
}
```

Use this folder as **visual/code reference** when aligning the Fainens accounts / command center UI (`frontend/src/routes/accounts.tsx`).
