# Chrome Web Store submission: Passage Progress

Everything needed to publish the extension as an **unlisted** Chrome Web Store item. Unlisted means
only people with the link can find it, and they install it with one click. Steps marked **(you)** need
your Google account.

Upload file: `dist/passage-progress-<version>.zip` (run `python3 tools/build.py` to regenerate it).

## 1. Developer account (you, one time)

1. Go to the Chrome Web Store Developer Dashboard: https://chrome.google.com/webstore/devconsole
2. Sign in with the Google account that should own the listing, accept the developer agreement,
   and pay the one-time registration fee ($5 at the time of writing).
3. Fill in the account page (publisher name, contact email) and verify the email.
   The publisher name is shown on the listing.

## 2. Upload (you)

Dashboard → **New item** → upload `dist/passage-progress-1.1.0.zip`.

## 3. Store listing tab

| Field | Value |
| --- | --- |
| Description | (paste the text below) |
| Category | Education (under Productivity) |
| Language | English |
| Store icon (128×128) | `icons/icon128.png` |
| Screenshots (1280×800) | `store/screenshot-1.png`, `store/screenshot-2.png` |
| Small promo tile (440×280) | `store/promo-small.png` |
| Homepage URL | https://ehb54.github.io/passage-progress/ |
| Support URL | https://github.com/ehb54/passage-progress/issues |

The short summary under the name comes from the manifest:
"Shows how far through a page you are, plus your progress through a start/end passage you mark."

**Description** (paste as-is):

```
Reading a long web page together? Passage Progress shows everyone where you are.

• Page %: how far through the page you've scrolled, and roughly how many screens are left.
• Passage %: mark where today's passage starts and ends (right-click a line, or use the meter), and see progress through just that part, with START/END lines on the page.
• Pick up where you stopped: before you leave, click "Stopped here" on the line where you ended. It leaves a dated marker, e.g. "Stopped Tue, Nov 11, 3:40 PM". Next time, "Resume" jumps straight back. Each meeting can leave its own marker.
• Your progress is shown in a small meter you can drag anywhere, on the toolbar icon, and at the top of the right-click menu.
• Zoom in to make the text bigger (Ctrl/Cmd +). The meter stays the same small size.
• Marks are tied to the text, so they stay on the right line when the page reflows, and they come back when you revisit the page.

Keyboard: Alt+Shift+S / E to set start / end, Alt+Shift+X to mark where you stopped, Alt+Shift+P to show or hide the meter.

Private by design: no accounts, no tracking, no network requests. Marks are saved only in your browser.
```

## 4. Privacy practices tab

**Single purpose:**

```
Shows the user's reading progress through the current web page, and through a passage on it that the user marks, so a group reading together can keep track of where they are and where they stopped.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the passage marks, dated "stopped here" markers and meter position the user sets, locally in the browser, so they are restored when the user returns to the page. |
| `contextMenus` | Adds right-click items to mark the passage start/end and where reading stopped, and shows the current progress percentage in the menu. |
| `scripting` | When the extension is installed or updated, adds the progress meter to tabs that are already open, so the user doesn't have to reload them. |
| Host permission (`<all_urls>`) | The meter has to appear on whatever page the user is reading. The content script reads the page's scroll position and text layout locally to compute progress. No page data is collected or transmitted. |

**Remote code:** "No, I am not using remote code." (All code is in the package. Nothing is loaded from the network.)

**Data usage:** leave every data-type box unchecked (it collects none). Tick the three
certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://ehb54.github.io/passage-progress/privacy.html

## 5. Distribution tab

- Payments: Free
- Visibility: **Unlisted**
- Regions: All regions

## 6. Submit for review (you)

Click **Submit for review**. Review usually takes a few days. Extensions that can run on all sites
sometimes get a longer review. You'll get an email when it's approved.

## 7. After approval

Copy the item's store URL (`https://chromewebstore.google.com/detail/…`), then:

1. Set `STORE_URL` in `tools/build.py` to it and run `python3 tools/build.py`. The install page's
   "Add to Chrome" button appears.
2. Commit and push `docs/`.

Share the install page (https://ehb54.github.io/passage-progress/) with the group. It offers both the
one-click extension and the no-install bookmarklet.

## Updating later

Bump `"version"` in `manifest.json`, run `python3 tools/build.py`, then in the dashboard open the item →
**Package** → **Upload new package** with the new ZIP → **Submit for review**. Installed copies update
automatically after approval.
