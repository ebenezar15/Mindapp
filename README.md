# Mindapp

**Organise, sequence and group your notes and brainstorms with one click, without a single sentence being added or removed.**

Mindapp is an installable web app (PWA) that runs on **iPhone, iPad and Mac** from one codebase. It works offline and keeps your notes on your device. You can sync between devices by **Mail**.

## What it does

| | |
|---|---|
| ⤓ **Import** | Paste from Apple Notes (or any app), or open `.txt`, `.md`, `.html`, `.rtf` and `.opml` files. Notes are split into cards by sentence, line or paragraph. Headings become groups and bullet lists are recognised. |
| 🔒 **Your words, untouched** | Every import is checked to prove the cards contain exactly your text, with nothing added or dropped. The sidebar's **Verbatim check** tracks every imported sentence. If you edit a card yourself, the original is kept and can be restored. Text is only ever deleted when *you* empty the Trash. |
| ✨ **One-click Organise** | Groups related sentences by topic (and by your `#tags`), names the groups, and orders each one so connected ideas sit together. New notes in the Inbox are filed into your existing groups. You can undo it. |
| ⇅ **Sequence** | Order a group by *Flow* (related sentences next to each other), original order, questions first, A→Z, newest or oldest. Drag to fine-tune. |
| ⚡︎ **Brainstorm mode** | A distraction-free page: type, press Enter, repeat. Thoughts are filed into matching groups as you go, related ideas from your board appear on the side, and there are idea prompts and sprint timers. |
| 👀 **Five views** | **Outline**, **Kanban** (columns by group *or* by status: Idea → Exploring → Ready → Done), **Mind map** (pan, pinch-zoom, fold branches, drop a note on a branch to regroup), **Cards** (sticky notes) and **Document** (your text in its new order, ready to copy, mail or print). |
| ✉︎ **Sync via Mail** | *Sync → Email a backup* opens the share sheet, where you pick Mail. On the other device, open the attachment, then *Sync → Open a backup → Merge*. The newest edit of each note wins and nothing is silently dropped. |
| ⤴︎ **Export** | Markdown, plain text, OPML (opens as a mind map in MindNode, iThoughts or OmniOutliner), and print/PDF. |
| 🧩 **More** | Multiple boards, multi-select (⌘/⇧-click), group colours, note highlights, tags, search, a "similar notes" finder (flags duplicates and never removes them), Trash, light/dark mode, and keyboard shortcuts. |

All the "intelligence" (topic clustering, sequencing, suggestions, similarity) runs **on your device**. No account, no server and no AI service: your notes never leave your devices unless you email them.

## Install on your Apple devices

1. Open the app's URL (see *Hosting* below) in **Safari**.
2. **iPhone / iPad:** Share → **Add to Home Screen**.
   **Mac:** Safari → File → **Add to Dock** (macOS Sonoma or later).
3. It now opens like a normal app and works offline.

### Importing from Apple Notes
- **iPhone / iPad:** open a note → Select All → Copy → in Mindapp tap **Import** and paste. You can paste several notes at once.
- **Mac:** in Notes press ⌘A then ⌘C → Mindapp **Import** → paste. Or drop exported text/HTML files onto the window.

## Hosting

The included workflow (`.github/workflows/pages.yml`) runs the tests and publishes the app to **GitHub Pages** on every push.
To turn it on: repository **Settings → Pages → Source: GitHub Actions**. The app will then be at `https://<your-user>.github.io/<repo>/`.

Any static host works (Netlify, Cloudflare Pages, iCloud-hosted site…). HTTPS is needed for offline mode and installation.

## Develop

No build step and no dependencies: plain HTML, CSS and ES modules.

```bash
npm start      # serves on http://localhost:8080
npm test       # parser, organiser, sync and export tests (node --test)
```

```
index.html           app shell
css/styles.css       Apple-style UI, light & dark, phone → desktop
js/parse.js          lossless sentence/line/paragraph splitting (+ proof)
js/nlp.js            on-device TF-IDF clustering, sequencing, suggestions
js/store.js          state, IndexedDB persistence, undo/redo, organise, merge-sync
js/views.js          outline, kanban, cards, document views
js/mindmap.js        SVG mind map with pan / zoom / drag-to-regroup
js/drag.js           pointer-based drag & drop (mouse, trackpad, touch, Pencil)
js/export.js         Markdown, text, OPML, HTML export
js/app.js            controller: UI wiring, dialogs, brainstorm, import, sync
sw.js                offline cache
```

### Keyboard shortcuts
`N` new thought · `B` brainstorm · `O` organise · `/` search · `1`–`5` switch view · `⌘Z` / `⇧⌘Z` undo/redo · `⌫` trash selected · `Esc` close
