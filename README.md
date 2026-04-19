# 📖 KJV Reader

A clean, fast Bible reading app for the King James Version with verse highlighting and date-sorted highlight history. Built as a vanilla HTML/CSS/JS single-page app — no build step, no dependencies.

## Features

### Reading
- All 66 books of the Bible (Old & New Testament)
- Clean chapter navigation: prev/next buttons, book selector, chapter selector
- **Swipe left/right** to navigate chapters (touch-friendly)
- **Jump-to search**: type `John 3` or `Psalm 119` → jumps immediately
- Remembers your last position between sessions
- Serif font (Georgia) for comfortable reading
- Adjustable font size (14–28px)
- **Dark mode** (default) and light mode

### Highlighting
- Tap any verse to select it
- **5 highlight colors**: yellow, green, blue, pink, orange
- Floating color picker — not a modal, stays out of your way
- **Range highlight**: tap the first verse, then tap the last verse while the picker is open → highlights the whole range
- Tap a highlighted verse to remove its highlight
- Highlights persist in `localStorage`

### Highlights View
- All highlights sorted **newest first** by default
- Grouped by date: "Today", "Yesterday", or full date
- Switch to **Book order** with the "By Book" tab
- Filter by color, search by text or reference
- Tap any highlight to jump back to that chapter/verse

### PWA
- Works offline (chapters are cached in `localStorage` after first load)
- Add to Home Screen on iPad/iPhone via Safari → Share → Add to Home Screen

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page app shell |
| `style.css` | All styles (dark + light mode, responsive) |
| `app.js` | Navigation, API fetching, highlighting logic |
| `bible-books.js` | Book names, chapter counts, abbreviations, reference parser |
| `manifest.json` | PWA manifest |

## Running Locally

Just open `index.html` in a browser. No server needed — but note that the Bible API calls are HTTPS, so you'll need internet access for chapters not yet cached.

For local dev with a server:
```bash
# Python 3
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080`.

## Bible API

Uses [bible-api.com](https://bible-api.com) — free, no key required.

```
GET https://bible-api.com/{Book}+{chapter}?translation=kjv
```

Chapters are cached in `localStorage` as `kjv-cache-{book}-{chapter}` after the first fetch.

## Data Storage

All data lives in `localStorage`:

| Key | Contents |
|-----|----------|
| `kjv-highlights` | JSON array of highlight objects |
| `kjv-position` | `{ bookIndex, chapter }` — last reading position |
| `kjv-settings` | `{ fontSize, darkMode }` |
| `kjv-cache-{Book}-{chapter}` | Cached chapter verses |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` | Previous chapter |
| `→` | Next chapter |
| `Esc` | Close color picker / selection |

## Highlight Object Schema

```json
{
  "id": "john-3-16",
  "reference": "John 3:16",
  "text": "For God so loved the world...",
  "color": "#FFEB3B",
  "date": "2026-04-19T09:41:00.000Z",
  "bookIndex": 42,
  "book": "John",
  "chapter": 3,
  "verse": 16
}
```
