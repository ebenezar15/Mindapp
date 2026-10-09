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
| 🎙 **Voice to text** | Tap the mic in the capture bar, Brainstorm, a note or Import (or press `V`). Your words are inserted exactly as recognised. In Brainstorm, **Hands-free** saves each spoken thought automatically. 20 languages, including English (US/UK/India), Tamil, Hindi, Malayalam, Telugu and Kannada. |
| ⚡︎ **Brainstorm mode** | A distraction-free page: type, press Enter, repeat. Thoughts are filed into matching groups as you go, related ideas from your board appear on the side, and there are idea prompts and sprint timers. |
| 👀 **Five views** | **Outline**, **Kanban** (columns by group *or* by status: Idea → Exploring → Ready → Done), **Mind map** (pan, pinch-zoom, fold branches, drop a note on a branch to regroup), **Cards** (sticky notes) and **Document** (your text in its new order, ready to copy, mail or print). |
| ✉︎ **Sync via Mail** | *Sync → Email a backup* opens the share sheet, where you pick Mail. On the other device, open the attachment, then *Sync → Open a backup → Merge*. The newest edit of each note wins and nothing is silently dropped. |
| ⤴︎ **Export** | Markdown, plain text, OPML (opens as a mind map in MindNode, iThoughts or OmniOutliner), and print/PDF. |
| 🧩 **More** | Multiple boards, multi-select (⌘/⇧-click), group colours, note highlights, tags, search, a "similar notes" finder (flags duplicates and never removes them), Trash, light/dark mode, and keyboard shortcuts. |

All the "intelligence" (topic clustering, sequencing, suggestions, similarity) runs **on your device**. No account, no server and no AI service: your notes never leave your devices unless you email them.

## Download for Mac, Windows and Linux

Desktop versions of the same app, with notes saved privately on your computer:

| Download | For |
|---|---|
| `Mindapp-Mac-AppleSilicon.zip` | Macs with an M1, M2, M3 or M4 chip (Apple menu → About This Mac → "Chip: Apple …") |
| `Mindapp-Mac-Intel.zip` | Older Macs with an Intel processor |
| `Mindapp-Windows.zip` | Windows 10 / 11 (64-bit) |
| `Mindapp-Linux.zip` | 64-bit Linux |

Each zip contains a **HOW TO INSTALL.txt** guide.
- **Mac:** unzip, drag **Mindapp.app** to Applications, and double-click it. The first time, macOS blocks apps from outside the App Store, so go to **System Settings → Privacy & Security → Open Anyway**. If it says the app "is damaged", run `xattr -cr /Applications/Mindapp.app` in Terminal once.
- **Windows:** Extract All, then run **Mindapp.exe**. If you see "Windows protected your PC", click **More info → Run anyway**.

On desktop, voice input uses your computer's own dictation: **Fn (🌐) twice** on Mac, **Windows key + H** on Windows.
To rebuild the desktop apps yourself: GitHub → **Actions → Desktop apps → Run workflow**, then download the zips from the run's artifacts. Or run `cd desktop && npm install && npm run build`.

## Install on iPhone and iPad

Mindapp is a web app you add to your Home Screen. Once added, it opens full-screen like any other app and works offline.

1. **Get the app online once** (see *Hosting* below). The easiest way is GitHub Pages, which gives you an address like `https://ebenezar15.github.io/Mindapp/`.
2. On the iPhone/iPad, open that address in **Safari**. It must be Safari for the install option to appear.
3. Tap the **Share** button (the square with an arrow ↑).
4. Scroll down and tap **Add to Home Screen**. Leave **Open as Web App** switched on if you see it, then tap **Add**.
5. Open **Mindapp** from your Home Screen. The first time you use the mic, tap **Allow** for microphone access.

**Mac:** open the address in Safari → **File → Add to Dock** (macOS Sonoma or later). In Chrome, use the install ⊕ icon in the address bar.

> Your notes live on each device separately, in that device's app storage. Deleting the Home Screen app deletes its notes, so email yourself a backup first (below).

## Sync between iPhone, iPad and Mac (via Mail)

**Send from the device with the latest changes:**
1. Tap **✉︎ Sync** in the top bar (on iPhone: **⋯ → Sync & export**).
2. Tap **Email a backup**. The share sheet opens; choose **Mail** and send it to yourself.
   (If there's no share sheet, the backup file downloads and an email opens. Attach the downloaded `Mindapp-backup-….mindapp.json`.)

**Receive on the other device:**
1. Open the email, then tap and hold the attachment → **Save to Files** (iCloud Drive is a good place).
2. Open Mindapp → **Sync → Open a backup…** → pick the file.
3. Choose **Merge**. Both devices' notes are combined, and where the same note was edited on both, the newer edit wins. Nothing is silently dropped. (**Replace** makes this device an exact copy instead.)

Tips: keep one backup in iCloud Drive as a safety copy. **Email as text** and **Export Markdown/OPML** are for sharing your writing, not for syncing.

## Voice to text

- Tap 🎙 in the capture bar, in Brainstorm, in a note's editor or in Import, or press `V`. Tap again to stop.
- **Brainstorm → Hands-free**: each spoken phrase is saved as its own thought and filed into a matching group, so you can just think out loud.
- Choose the language in **Settings → Voice to text language**.
- If the mic button reports that voice isn't available (this can happen in Home Screen apps on some iOS versions, or offline), use the **🎙 key on the iPhone/iPad keyboard**. It dictates into any Mindapp text box. On a Mac, press **Fn** twice.

### Importing from Apple Notes
- **iPhone / iPad:** open a note → Select All → Copy → in Mindapp tap **Import** and paste. You can paste several notes at once.
- **Mac:** in Notes press ⌘A then ⌘C → Mindapp **Import** → paste. Or drop exported text/HTML files onto the window.

## Hosting

The included workflow (`.github/workflows/pages.yml`) runs the tests and publishes the app to **GitHub Pages** on every push.
To turn it on: repository **Settings → Pages → Source: GitHub Actions**. The app will then be at `https://<your-user>.github.io/<repo>/`.

**No GitHub? Use the download instead:** unzip `Mindapp.zip`, go to <https://app.netlify.com/drop> and drag the unzipped `Mindapp` folder onto the page. You get a free HTTPS address in seconds; open it in Safari on your iPhone/iPad and follow the install steps above.

Any static host works (Netlify, Cloudflare Pages, your own site). HTTPS is required for installing, offline use and the microphone. Opening `index.html` straight from Files won't work, because browsers block app modules on `file://`. To try it on a computer, run `npm start` and open http://localhost:8080.

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
js/voice.js          voice to text (Web Speech API) with graceful fallback
desktop/             Electron shell + build script for the Mac/Windows/Linux apps
js/app.js            controller: UI wiring, dialogs, brainstorm, import, sync
sw.js                offline cache
```

### Keyboard shortcuts
`N` new thought · `V` voice · `B` brainstorm · `O` organise · `/` search · `1`–`5` switch view · `⌘Z` / `⇧⌘Z` undo/redo · `⌫` trash selected · `Esc` close
