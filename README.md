# Once It Leaves — traveler collection prototype

A local, privacy conscious prototype for a collection of digital asset characters. The interface keeps the watercolor map and character art; each traveler now has its own passport, evidence map, and first-person diary.

## Run in VS Code

The recommended launch uses Vite so the official C2PA browser SDK and its WebAssembly file can run. If you double-click `index.html`, a fallback keeps file upload, passports, maps, and diaries usable; credential inspection is unavailable in that mode and browser storage may vary.

```bash
pnpm install
pnpm dev
```

Open the local address printed by Vite. For a static build, run `pnpm build`; the generated `dist/` directory can be served by a normal static host over HTTPS.

## What works

- Upload PDF, Word, image, audio, or video assets. Every upload creates a separate traveler; files are saved by traveler ID in browser IndexedDB when allowed.
- Pick a traveler from **My travelers**. Its passport, map findings, and diary are independent of other travelers. **Read diary** opens that traveler's map and scrolls to its entries. A diary entry is written only from a recorded sighting; it does not invent travel.
- For JPG/PNG, the official `@contentauth/c2pa-web` SDK reads the selected file locally and reports no embedded credential, trusted, valid but untrusted, invalid, or unable to check. The C2PA trust-list request is made over the network. A credential's signed claims are not proof that every statement in the image is true.
- From the passport, open Adobe Content Authenticity to apply Content Credentials to a supported JPG/PNG. Download the signed file and choose **Use signed JPG/PNG** to attach that version to the same traveler. The old map findings are cleared because the bytes changed, while the local passport stays. Our passport choices are **not** automatically written into Adobe's credential; Adobe uses its own account and preference settings.
- Search Wikimedia Commons for a matching SHA-1 and file size, open a name-based web search, or add and compare a publicly found file copy. The map pins recorded findings only and does not infer a path between them.
- Export the current traveler's evidence ledger as JSON. Remove a sighting or traveler when needed.

## Boundaries

- C2PA inspection is implemented for JPG and PNG in this edition. Other uploaded kinds keep their passport and map but show the image-only inspection limit. Adobe Content Authenticity's web Apply supports eligible JPG/PNG files; it is a separate Adobe workflow, not an embedded API or automatic signing service.
- The passport is a local statement of creator intent. The C2PA status reads credentials already in the selected file. Neither establishes whole-web propagation or enforces every use preference.
- A Wikimedia Commons hash/size match is evidence of a likely identical file in that collection. A user-entered URL is only a reported context unless a downloaded copy is compared locally. Private sharing and edited derivatives remain unknown.
- The uploaded file stays in the browser. Selecting a JPG/PNG can cause the C2PA SDK to request the public trust list or referenced remote manifest; pressing the Commons search button sends the file's SHA-1 fingerprint to Commons. No file bytes are sent by our app, except when you explicitly use Adobe's separate service.

## Source organization

- `index.html` — collection, upload, passport, map, diary
- `style.css` — formatted, sectioned visual system and responsive layout
- `script.js` — per-traveler state, local files, diary, search, and UI
- `c2pa-reader.js` — official SDK wrapper for JPG/PNG inspection
- `assets/` — original character sprite sheet and watercolor map
