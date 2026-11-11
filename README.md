# Passage Progress

A small browser tool for reading long web pages in a group. It shows:

- **Page %**: how far through the page you've scrolled, plus "≈ N screens to go".
- **Passage %**: once you mark where the assigned passage **starts** and **ends**,
  your progress through just that stretch, with dashed START/END lines on the page.
- **Where you stopped**: dated "⏸ Stopped Tue, Nov 11, 3:40 PM" markers you leave at the end
  of a meeting. **Resume** jumps straight back to the latest one next time.

The numbers appear in a small draggable meter in the corner of the page and in a thin bar
along the top edge. With the extension they also appear on the toolbar icon (grey = page,
green = passage) and at the top of the right-click menu (e.g. **Passage 63% · Page 41%**).
The meter keeps the same size when you zoom the page (⌘+ / Ctrl+).

**Install page:** https://ehb54.github.io/passage-progress/

## Getting it

1. **Chrome Web Store** (one click; coming soon).
2. **Bookmarklet**, with no install, from the [install page](https://ehb54.github.io/passage-progress/).
   Drag the button to your bookmarks bar. Click it on a page to show the meter, and click again to hide it.
   Works in Chrome, Edge, Firefox and Safari. It has no toolbar % or right-click menu, and after a
   page reload you click it again.
3. **From this repository** (Developer mode):
   1. Click **Code → Download ZIP** and unzip it somewhere you'll keep it (Chrome loads the
      extension from that folder), or `git clone https://github.com/ehb54/passage-progress.git`.
   2. Open `chrome://extensions`, turn on **Developer mode** (top right).
   3. Click **Load unpacked** and choose the folder containing `manifest.json`.
   4. Optional: pin **Passage Progress** from the puzzle-piece menu.

   To update, replace the folder's contents (or `git pull`), then click ↻ on the extension's
   card in `chrome://extensions`. Tabs that were already open get the meter automatically.
   For local `file://` pages, turn on **Allow access to file URLs** in the extension's Details.

## Use

| To… | Do this |
| --- | --- |
| Mark the passage start | Right-click the first line → **Passage … · Page …% → Set passage START here** |
| Mark the passage end | Right-click the last line → **Set passage END here** |
| …or with the meter | Hover the meter → **Set start** / **Set end**, then click the line (Esc cancels) |
| …or with the keyboard | ⌥⇧S / ⌥⇧E (Alt+Shift+S / E), then click the line |
| Leave a dated "stopped here" marker | Hover the meter → **Stopped here**, then click the line. Or right-click it → **Mark where we stopped (dated)**, or ⌥⇧X |
| Go back to where you stopped | Hover the meter → **Resume** |
| Delete a stopped-here marker | Click the **×** on its label |
| Jump to the passage start | Hover the meter → **Go to start** |
| Remove the start/end marks | Hover the meter → **Clear**, or right-click → **Clear passage marks** (stop markers stay) |
| Hide/show the meter | Toolbar icon, ⌥⇧P, or hover the meter → **✕**. Bookmarklet: click the bookmark |
| Move the meter | Drag it. Double-click to send it back to the corner |

Notes:

- If you set only a start, the passage runs to the end of the page. If you set only
  an end, it runs from the top.
- Each meeting can leave its own stop marker (up to 30 per page). The newest is drawn bold and
  older ones faded, so you can see how far you got each time.
- Marks are tied to the text itself, not to a pixel position. They stay on the right
  line when images load, the window is resized, or you zoom. They're saved per page
  address, so they come back if you reload or revisit the page.
- 0% means the START line is at the top of the window, and 100% means the END line
  has reached the bottom. This is the same rule as ordinary page scroll %.
- Keyboard shortcuts can be changed at `chrome://extensions/shortcuts`.

## Limitations

- **PDFs in Chrome's built-in viewer** and Chrome's own pages (`chrome://…`, the Web
  Store) don't allow extensions to draw on them.
- Content inside an **embedded frame** (some LMS pages put the reading in an iframe)
  isn't tracked. The meter follows the main page only. Opening the frame's content in its
  own tab works around this.
- Pages that draw text on a canvas (e.g. Google Docs) get a correct page %, but
  marks there are approximate (anchored by position, not by text).
- Bookmarklet only: marks are kept in that website's own storage, and its zoom detection is an
  estimate (it assumes 100% if a side panel is open next to the page).

## Privacy

Nothing leaves your browser. There are no network requests. Marks and settings are kept in
`chrome.storage.local` (bookmarklet: the site's localStorage). The 500 most recently marked pages are
retained. The "read and change data on all websites" permission is what lets the meter appear on any
page you read. Full policy: https://ehb54.github.io/passage-progress/privacy.html

## Files

- `manifest.json`, `background.js`, `content.js`, `icons/`: the extension (Manifest V3)
- `bookmarklet/shim.js`: stand-ins for the extension APIs used by the bookmarklet build
- `site/`: install page and privacy policy templates
- `docs/`: **generated** GitHub Pages site (install page with the bookmarklet link baked in)
- `store/`: Chrome Web Store listing text and images
- `tools/build.py`: regenerates `docs/` and `dist/passage-progress-<version>.zip` (the store
  upload). Run it after changing `content.js` and commit `docs/`
- `tools/make_icons.py`: regenerates the icons
- `tools/run_selftest.py`: runs a test page in headless Chrome and prints its results, e.g.
  `python3 tools/run_selftest.py test/selftest.html` (also `test/bookmarklet-strict.html`,
  `test/bookmarklet-href.html`)
- `test/`: test pages. `chrome-stub.js` fakes the extension APIs, so `test.html` and `inner.html`
  can be opened by hand from `python3 -m http.server`
