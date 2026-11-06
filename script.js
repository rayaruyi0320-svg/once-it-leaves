(() => {
  "use strict";
  const STATE_KEY = "once-it-leaves-v7";
  const DB_NAME = "once-it-leaves-local-assets";
  const $ = id => document.getElementById(id);
  const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const blank = () => ({
    id: newId(), stage: "upload", passportPhase: 0, asset: null,
    passport: { creator: "", credit: "required", ai: "ask", commercial: "not-allowed" },
    credential: { status: "unchecked", label: "Not checked", detail: "" },
    observations: [], createdAt: new Date().toISOString()
  });
  const valid = { credit: ["required", "optional"], ai: ["ask", "allowed", "not-allowed"], commercial: ["not-allowed", "ask", "allowed"] };
  const labels = { required: "Required", optional: "Optional", ask: "Ask first", allowed: "Allowed", "not-allowed": "Not allowed" };
  const categories = ["student", "ai", "commercial", "public"];

  function normalizeJourney(raw) {
    if (!raw || !raw.asset || typeof raw.asset.name !== "string") return null;
    const journey = blank();
    journey.id = typeof raw.id === "string" ? raw.id : newId();
    journey.stage = ["upload", "passport", "map"].includes(raw.stage) ? raw.stage : "upload";
    journey.passportPhase = Math.max(0, Math.min(4, Number(raw.passportPhase) || 0));
    journey.asset = raw.asset;
    journey.passport = { ...journey.passport, ...raw.passport };
    journey.credential = raw.credential && typeof raw.credential.status === "string" ? raw.credential : journey.credential;
    journey.observations = Array.isArray(raw.observations) ? raw.observations.slice(0, 100) : [];
    journey.createdAt = raw.createdAt || journey.createdAt;
    return journey;
  }
  function loadLibrary() {
    try {
      const stored = JSON.parse(localStorage.getItem(STATE_KEY));
      if (stored && Array.isArray(stored.assets)) {
        const assets = stored.assets.map(normalizeJourney).filter(Boolean);
        const activeId = assets.some(item => item.id === stored.activeId) ? stored.activeId : null;
        return { assets, activeId, view: assets.length ? (stored.view === "journey" && activeId ? "journey" : "library") : "journey" };
      }
      const old = JSON.parse(localStorage.getItem("once-it-leaves-v6") || localStorage.getItem("once-it-leaves-v5"));
      const migrated = normalizeJourney(old);
      if (migrated) { migrated.id = "legacy-current"; return { assets: [migrated], activeId: migrated.id, view: "journey" }; }
    } catch { /* A damaged local record starts with an empty collection. */ }
    return { assets: [], activeId: null, view: "journey" };
  }
  let library = loadLibrary();
  let state = library.assets.find(item => item.id === library.activeId) || blank();
  let file = null, objectURL = null, selectedCategory = null;
  let storageMessage = "", hashBusy = false, hashFailure = "", libraryMessage = "";

  function save() {
    if (state.asset && !library.assets.includes(state)) library.assets.push(state);
    if (state.asset) library.activeId = state.id;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(library)); }
    catch { storageMessage = "This browser could not save your traveler collection."; }
  }
  function openDB() { return new Promise((resolve, reject) => { if (!window.indexedDB) return reject(new Error("Local database unavailable")); const req = indexedDB.open(DB_NAME, 1); req.onupgradeneeded = () => req.result.createObjectStore("files"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  async function saveFile(value, id) { const db = await openDB(); try { await new Promise((resolve, reject) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(value, id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); } }
  async function getFile(id) { const db = await openDB(); try { return await new Promise((resolve, reject) => { const tx = db.transaction("files", "readonly"); const req = tx.objectStore("files").get(id); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); } finally { db.close(); } }
  async function deleteFile(id) { try { const db = await openDB(); try { await new Promise((resolve, reject) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } finally { db.close(); } } catch { /* Reset still clears journey state. */ } }
  function isC2paImage(value) { return !!value && (["image/jpeg", "image/png"].includes(value.type) || /\.(jpe?g|png)$/i.test(value.name)); }
  function kindFor(value) { const name = value.name.toLowerCase(), type = value.type.toLowerCase(); if (name.endsWith(".pdf") || type === "application/pdf") return "pdf"; if (/\.(doc|docx)$/.test(name) || /word|officedocument/.test(type)) return "word"; if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|heic)$/.test(name)) return "image"; if (type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name)) return "audio"; if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi)$/.test(name)) return "video"; return null; }
  async function hashBlob(blob, algorithm) {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this browser context");
    if (blob.size > 256 * 1024 * 1024) throw new Error("Fingerprint not calculated for files larger than 256 MB in this prototype.");
    const digest = await crypto.subtle.digest(algorithm, await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const sha256Blob = blob => hashBlob(blob, "SHA-256");
  const sha1Blob = blob => hashBlob(blob, "SHA-1");
  function humanSize(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
  function clearObjectURL() { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null; document.documentElement.style.removeProperty("--asset-thumb"); }
  function showError(message) { $("uploadError").textContent = message; $("uploadError").hidden = !message; }
  async function inspectFile(chosen, journeyId) {
    const journey = library.assets.find(item => item.id === journeyId);
    if (!journey) return;
    const inspectedAsset = journey.asset;
    journey.credential = { status: "checking", label: "Checking image credentials…", detail: "" };
    save(); renderCredential();
    try {
      if (globalThis.location?.protocol === "file:") {
        journey.credential = { status: "unavailable", label: "Open local server to check credentials", detail: "Upload works here. Run pnpm dev for C2PA inspection." };
        save(); renderCredential(); return;
      }
      const { inspectCredentials } = await import("./c2pa-reader.js");
      const result = await inspectCredentials(chosen);
      if (journey.asset === inspectedAsset) journey.credential = result;
    } catch (error) {
      journey.credential = { status: "unavailable", label: "Credential check unavailable", detail: `The browser could not start the C2PA checker: ${error.message}` };
    }
    save(); renderCredential();
  }
  async function fingerprintFile(chosen, journeyId) {
    const results = await Promise.allSettled([sha256Blob(chosen), sha1Blob(chosen)]);
    const journey = library.assets.find(item => item.id === journeyId);
    if (!journey || file !== chosen) return;
    journey.asset.sha256 = results[0].status === "fulfilled" ? results[0].value : null;
    journey.asset.sha1 = results[1].status === "fulfilled" ? results[1].value : null;
    hashFailure = results[0].status === "rejected" ? results[0].reason.message : "";
    hashBusy = false; save();
    if (journey.stage === "map") { renderHash(); renderDiscovery(); }
  }
  async function chooseFile(chosen, preservePassport = false) {
    if (!chosen) return;
    const kind = kindFor(chosen);
    if (!kind) return showError("Choose a PDF, Word document, image, audio, or video file.");
    if (preservePassport && !isC2paImage(chosen)) {
      $("signedFileMessage").textContent = "Choose a signed JPG or PNG image.";
      $("signedFileMessage").hidden = false;
      return;
    }
    clearObjectURL();
    if (!preservePassport) state = blank();
    else state.observations = [];
    file = chosen; library.view = "journey"; library.activeId = state.id;
    selectedCategory = null; storageMessage = ""; hashBusy = true; hashFailure = "";
    state.asset = { name: chosen.name, size: chosen.size, type: chosen.type, kind, sha256: null, sha1: null };
    state.credential = { status: "checking", label: "Checking image credentials…", detail: "" };
    state.stage = preservePassport ? "passport" : "upload";
    save(); showError(""); render();
    const checks = [fingerprintFile(chosen, state.id), inspectFile(chosen, state.id)];
    try { await saveFile(chosen, state.id); storageMessage = "Saved in this browser."; }
    catch { storageMessage = "Available this session; the browser could not save the file for reopening."; }
    if ($("storageStatus")) $("storageStatus").textContent = storageMessage;
    await Promise.all(checks);
    if (preservePassport) {
      $("signedFileMessage").textContent = "Signed image selected. Review its credential status, then send this traveler off.";
      $("signedFileMessage").hidden = false;
      render();
    }
  }
  function setSprite(sprite) { if (sprite && state.asset) sprite.className = `asset-sprite kind-${state.asset.kind}`; }
  function updateCharacters() {
    const has = !!file && !!state.asset;
    $("waitingCharacters").hidden = has; $("uploadAvatar").hidden = !has;
    if (!has) { $("uploadBubble").textContent = "Who will travel today?"; return; }
    for (const id of ["uploadSprite", "passportSprite", "mapSprite"]) setSprite($(id));
    $("uploadBubble").textContent = `Hi! I'm your ${state.asset.kind.toUpperCase()} traveler.`;
    if (!objectURL) objectURL = URL.createObjectURL(file);
    if (state.asset.kind === "image") document.documentElement.style.setProperty("--asset-thumb", `url("${objectURL}")`);
  }
  function renderFilePreview() {
    const wrap = $("assetPreview"), media = $("mediaPreview"); wrap.replaceChildren(); media.replaceChildren(); media.hidden = true;
    if (!file || !state.asset) return;
    if (!objectURL) objectURL = URL.createObjectURL(file);
    const kind = state.asset.kind;
    if (kind === "image") { const img = document.createElement("img"); img.src = objectURL; img.alt = "Selected image preview"; wrap.append(img); }
    else { const icon = document.createElement("span"); icon.textContent = kind.toUpperCase(); wrap.append(icon); }
    if (kind === "audio" || kind === "video") { const player = document.createElement(kind); player.src = objectURL; player.controls = true; player.preload = "metadata"; player.setAttribute("aria-label", `Selected ${kind} preview`); media.append(player); media.hidden = false; }
    if (kind === "pdf") { const frame = document.createElement("iframe"); frame.src = objectURL; frame.title = "Selected PDF preview"; media.append(frame); media.hidden = false; }
    $("uploadedName").textContent = state.asset.name;
    $("uploadedMeta").textContent = `${kind.toUpperCase()} · ${humanSize(state.asset.size)}`;
    $("storageStatus").textContent = storageMessage || "This file stays in your browser.";
  }
  function renderUpload() { $("uploadedAsset").hidden = !file; if (file) renderFilePreview(); else $("mediaPreview").hidden = true; renderCredential(); }
  function updatePassportPreview() {
    const p = state.passport, phase = state.passportPhase;
    $("passportFileName").textContent = state.asset?.name || ""; $("passportFileType").textContent = state.asset?.kind.toUpperCase() || "";
    $("passportCreatorPreview").textContent = p.creator || "—";
    $("passportCreditPreview").textContent = phase >= 2 ? labels[p.credit] : "—";
    $("passportAiPreview").textContent = phase >= 3 ? labels[p.ai] : "—";
    $("passportCommercialPreview").textContent = phase >= 4 ? labels[p.commercial] : "—";
    $("passportProgress").textContent = `${phase} / 4`;
    for (const [id, done] of [["stickerCreator", phase >= 1], ["stickerCredit", phase >= 2], ["stickerAi", phase >= 3], ["stickerCommercial", phase >= 4]]) $(id).classList.toggle("packed", done);
  }
  const packing = [
    { kicker: "PACKING 1 OF 4", question: "Who made this asset?", hint: "Start with its origin." },
    { kicker: "PACKING 2 OF 4", question: "Should others give credit?", hint: "Choose the note your traveler carries." , key: "credit", options: [["required", "Credit required", "Please name my creator."], ["optional", "Credit optional", "A name is welcome, but optional."]] },
    { kicker: "PACKING 3 OF 4", question: "What about AI reference?", hint: "Choose the boundary your traveler carries.", key: "ai", options: [["ask", "Ask first", "Please ask before using me."], ["allowed", "Allowed", "AI reference is okay."], ["not-allowed", "Not allowed", "Please do not use me this way."]] },
    { kicker: "PACKING 4 OF 4", question: "What about commercial use?", hint: "One last travel intention.", key: "commercial", options: [["not-allowed", "Not allowed", "Keep me out of commercial work."], ["ask", "Ask first", "Please request permission."], ["allowed", "Allowed", "Commercial use is okay."]] },
    { kicker: "PASSPORT COMPLETE", question: "Ready to leave?", hint: "The passport records intentions. The journey will show how they meet the world." }
  ];
  function safe(text) { return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]); }
  function renderCredential() {
    const credential = state.credential || { status: "unchecked", label: "Not checked", detail: "" };
    $("credentialCheck").hidden = !file;
    $("credentialCheck").dataset.status = credential.status;
    $("adobeApplyUploadLink").hidden = !file || !isC2paImage(file);
    $("uploadCredentialStatus").textContent = credential.label;
    $("uploadCredentialDetail").textContent = credential.detail;
    $("credentialStatus").textContent = credential.label;
    $("credentialDetail").textContent = credential.detail;
    $("credentialStatus").parentElement.dataset.status = credential.status;
  }
  function renderLibrary() {
    const grid = $("libraryGrid");
    grid.innerHTML = library.assets.length ? library.assets.map(item => {
      const count = item.observations.length;
      const name = safe(item.asset.name);
      const kind = safe(item.asset.kind);
      const ready = item.stage === "map";
      return `<article class="traveler-card"><div class="traveler-portrait"><div class="asset-sprite kind-${kind}" aria-hidden="true"></div></div><div class="traveler-card-copy"><span class="journal-type">${kind.toUpperCase()} TRAVELER</span><h2>${name}</h2><p>${safe(item.passport.creator || "Passport in progress")}</p><span class="traveler-count">${count} recorded trace${count === 1 ? "" : "s"}</span><small class="traveler-credential">${safe(item.credential?.label || "Not checked")}</small></div><div class="traveler-actions"><button type="button" data-open-id="${safe(item.id)}" data-open-target="${ready ? "diary" : "passport"}" class="primary-button">${ready ? "Read diary" : "Continue journey"} <span aria-hidden="true">→</span></button><button type="button" data-remove-asset="${safe(item.id)}" class="text-button">Remove traveler</button></div></article>`;
    }).join("") : '<div class="library-empty"><div class="asset-sprite kind-pdf" aria-hidden="true"></div><p>No travelers yet. Choose a file to begin their first journey.</p></div>';
    if (libraryMessage) {
      const message = document.createElement("p");
      message.className = "form-message";
      message.textContent = libraryMessage;
      grid.prepend(message);
    }
  }
  function startNewJourney() {
    clearObjectURL(); file = null; state = blank(); library.activeId = null;
    library.view = "journey"; selectedCategory = null;
    storageMessage = ""; hashBusy = false; hashFailure = ""; libraryMessage = "";
    save(); render(); $("uploadTitle").focus();
  }
  async function openJourney(id, target) {
    const journey = library.assets.find(item => item.id === id);
    if (!journey) return;
    let restored;
    try {
      restored = await getFile(id);
      if (!restored && id === "legacy-current") {
        restored = await getFile("current");
        if (restored) await saveFile(restored, id);
      }
    }
    catch { restored = null; }
    if (!restored || restored.name !== journey.asset.name || restored.size !== journey.asset.size) {
      libraryMessage = `The saved file for ${journey.asset.name} is unavailable in this browser. You can start a new traveler.`;
      renderLibrary(); return;
    }
    clearObjectURL(); state = journey; file = restored; library.activeId = id; library.view = "journey";
    selectedCategory = null; storageMessage = "Restored from this browser.";
    hashBusy = true; state.credential = { status: "checking", label: "Checking image credentials…", detail: "" };
    save(); render();
    const previousHash = state.asset.sha256;
    await Promise.all([fingerprintFile(restored, id), inspectFile(restored, id)]);
    if (previousHash && state.asset.sha256 && previousHash !== state.asset.sha256) {
      state.observations = []; save(); render();
    }
    if (target === "diary" && state.stage === "map") $("journalSection").scrollIntoView({ behavior: "smooth" });
  }
  function renderPassport() {
    if (!state.asset) return;
    const phase = state.passportPhase, config = packing[phase];
    $("packingStep").textContent = config.kicker; $("packingQuestion").textContent = config.question; $("packingHint").textContent = config.hint;
    $("creatorPrompt").hidden = phase !== 0; $("passportChoices").hidden = phase === 0 || phase === 4; $("readyPrompt").hidden = phase !== 4; $("previousPackingButton").hidden = phase === 0; $("packingError").hidden = true;
    $("creator").value = state.passport.creator;
    if (config.options) $("passportChoices").innerHTML = config.options.map(([value, title, note]) => `<button class="packing-choice" data-pref="${config.key}" data-value="${value}" type="button"><span class="choice-token" aria-hidden="true">✦</span><span><strong>${safe(title)}</strong><small>${safe(note)}</small></span><span aria-hidden="true">→</span></button>`).join("");
    $("passportSigning").hidden = !isC2paImage(state.asset);
    updatePassportPreview(); setSprite($("passportSprite"));
  }
  function renderHash() {
    const hash = state.asset?.sha256;
    $("hashValue").textContent = hash || (hashBusy ? "Calculating…" : "Unavailable");
    $("hashStatus").textContent = hash ? "Exact-byte identity for the uploaded file. It is not a tracking beacon." : hashBusy ? "Reading the file locally to calculate its fingerprint." : hashFailure || "This browser could not calculate a fingerprint.";
    $("copyHashButton").disabled = !hash;
  }
  function renderDiscovery() {
    const available = !!state.asset?.sha1;
    $("searchCommonsButton").disabled = !available;
    if (!available) $("commonsSearchStatus").textContent = hashBusy ? "Preparing the file fingerprint…" : "Fingerprint unavailable. You can still search by name or add a sighting.";
    const query = `"${state.asset?.name || ""}"`;
    $("webSearchLink").href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    $("webSearchLink").removeAttribute("aria-disabled");
  }
  async function searchCommons() {
    if (!state.asset?.sha1 || !file) return;
    const searchedFile = file, sha1 = state.asset.sha1, button = $("searchCommonsButton"), status = $("commonsSearchStatus");
    button.disabled = true; status.textContent = "Searching Wikimedia Commons for identical bytes…";
    const params = new URLSearchParams({ action: "query", list: "allimages", aisha1: sha1, aiprop: "url|sha1|size|timestamp", ailimit: "50", format: "json", formatversion: "2", origin: "*" });
    try {
      const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { credentials: "omit" });
      if (!response.ok) throw new Error(`Commons returned ${response.status}`);
      const data = await response.json();
      if (file !== searchedFile) return;
      if (data.error) throw new Error(data.error.info || "Commons search error");
      const hits = (data.query?.allimages || []).filter(item => item.sha1?.toLowerCase() === sha1 && item.size === state.asset.size && /^https:\/\/commons\.wikimedia\.org\//.test(item.descriptionurl || ""));
      let added = 0;
      for (const hit of hits) {
        if (state.observations.some(item => item.source === "wikimedia-commons" && item.url === hit.descriptionurl)) continue;
        state.observations.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, category: "public", url: hit.descriptionurl, note: `Wikimedia Commons file: ${hit.name || hit.title || "matching file"}`, addedAt: new Date().toISOString(), match: "source-exact", source: "wikimedia-commons", sourceTitle: hit.title || hit.name || "", sourceAssetUrl: hit.url || "", sourceSha1: hit.sha1, sourceSize: hit.size, publishedAt: hit.timestamp || "" });
        added++;
      }
      if (added) { save(); selectedCategory = "public"; renderMap(); }
      status.textContent = hits.length ? `${hits.length} exact file match${hits.length === 1 ? "" : "es"} found on Wikimedia Commons${added ? `; ${added} added to the map` : "; already on the map"}.` : "No identical file found on Wikimedia Commons. This says nothing about the rest of the web.";
    } catch (error) { if (file === searchedFile) status.textContent = `Commons search could not finish: ${error.message}. Try again later.`; }
    finally { if (file === searchedFile) button.disabled = false; }
  }
  function observationsFor(category) { return state.observations.filter(o => o.category === category); }
  const categoryLabels = { student: "Student project", ai: "AI studio", commercial: "Marketplace", public: "Public website" };
  function observationLabel(observation) {
    if (observation.match === "source-exact") return "Matching file found on Wikimedia Commons";
    if (observation.match === "exact") return "Exact local copy match";
    if (observation.match === "different") return "Different file bytes";
    if (observation.match === "unavailable") return "Comparison unavailable";
    return "Reported URL · file not checked there";
  }
  function renderPanel() {
    const panel = $("eventPanel"); panel.hidden = !selectedCategory;
    if (!selectedCategory) return;
    const items = observationsFor(selectedCategory);
    panel.innerHTML = `<button class="panel-close" type="button" data-close aria-label="Close sightings">×</button><span class="event-kicker">RECORDED SIGHTINGS</span><h3 tabindex="-1">${categoryLabels[selectedCategory]}</h3><p>Commons matches are checked against its file hash. Other links are user-reported and need review.</p><div class="sighting-list">${items.map(item => `<article><strong>${safe(observationLabel(item))}</strong><a href="${safe(item.url)}" target="_blank" rel="noopener noreferrer">Open ${item.source === "wikimedia-commons" ? "Commons file page" : "reported page"} ↗</a>${item.note ? `<p>${safe(item.note)}</p>` : ""}</article>`).join("")}</div>`;
  }
  function renderMap() {
    if (!state.asset) return;
    $("mapAssetName").textContent = state.asset.name; setSprite($("mapSprite")); renderHash(); renderDiscovery(); renderCredential();
    for (const category of categories) {
      const button = $(`${category}Stop`), count = observationsFor(category).length;
      button.disabled = count === 0; button.classList.toggle("visited", count > 0); button.classList.toggle("exact", observationsFor(category).some(item => ["exact", "source-exact"].includes(item.match))); button.classList.toggle("selected", selectedCategory === category);
      $(`${category}Status`).textContent = count ? `${count} sighting${count === 1 ? "" : "s"}` : "No sighting";
    }
    $("mapTraveler").style.left = "13%"; $("mapTraveler").style.top = "57%";
    $("mapHint").textContent = state.observations.length ? "Pins are sightings. No route is inferred between them." : "Add evidence below to place a pin.";
    renderPanel(); renderJournal();
  }
  function diaryVoice(item) {
    if (item.source === "wikimedia-commons") return "A file with my fingerprint appeared in Wikimedia Commons. I can see that match, but I cannot tell how I arrived.";
    if (item.match === "exact") return "Someone brought back a copy of me. Its bytes match mine, though the path between us is still unknown.";
    if (item.match === "different") return "A different file was found near my story. It might be related; I cannot verify that yet.";
    return `Someone noted a place where I may have appeared. I have a link to follow, but no proof from that page yet.`;
  }
  function renderJournal() {
    const entries = state.observations;
    $("exportEvidenceButton").disabled = entries.length === 0;
    $("journalList").innerHTML = entries.length ? entries.slice().reverse().map(item => `<li class="journal-item ${["exact", "source-exact"].includes(item.match) ? "exact-entry" : ""}"><span class="journal-type">${safe(categoryLabels[item.category])} · ${safe(new Date(item.addedAt).toLocaleDateString())}</span><h3>${safe(diaryVoice(item))}</h3><p class="diary-evidence">${safe(observationLabel(item))}</p><p><a href="${safe(item.url)}" target="_blank" rel="noopener noreferrer">View source ↗</a></p>${item.note ? `<p>${safe(item.note)}</p>` : ""}<button class="text-button remove-sighting" data-remove-id="${safe(item.id)}" type="button">Remove sighting</button></li>`).join("") : '<li class="journal-empty">No postcards yet. Search Commons or add a public sighting; this diary will only tell what you can actually see.</li>';
  }
  function evidenceMessage(message, bad = false) { const el = $("evidenceMessage"); el.textContent = message; el.hidden = !message; el.classList.toggle("error", bad); }
  async function addObservation(event) {
    event.preventDefault();
    if (state.stage !== "map" || !$("evidenceForm").reportValidity()) return;
    const raw = $("sourceUrl").value.trim(); let url;
    try { url = new URL(raw); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Public URL required"); }
    catch { evidenceMessage("Enter a valid public http or https URL.", true); return; }
    const category = $("sightingCategory").value;
    if (!categories.includes(category)) return;
    const proof = $("comparisonFile").files?.[0] || null;
    const submit = $("submitEvidenceButton"); submit.disabled = true; submit.textContent = proof ? "Comparing file…" : "Saving sighting…";
    let match = "reported", copyHash = null;
    if (proof) {
      try { copyHash = await sha256Blob(proof); match = state.asset?.sha256 ? (copyHash === state.asset.sha256 ? "exact" : "different") : "unavailable"; }
      catch { match = "unavailable"; }
    }
    state.observations.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, category, url: url.href, note: $("observationNote").value.trim().slice(0, 280), addedAt: new Date().toISOString(), match, copyName: proof?.name || "", copyHash });
    save(); $("evidenceForm").reset(); submit.disabled = false; submit.innerHTML = 'Add sighting to map <span aria-hidden="true">→</span>';
    selectedCategory = category; renderMap(); evidenceMessage(match === "exact" ? "Exact bytes matched locally. The URL is still a user-provided context." : match === "different" ? "Sighting saved. The compared file has different bytes; this may be a derivative." : "Sighting saved as a reported link; the asset at the URL was not verified.");
  }
  function exportEvidence() {
    if (!state.observations.length) return;
    const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), asset: state.asset, passport: state.passport, observations: state.observations, note: "User-reported URL contexts; local hash matches apply only to compared files. No route between sightings is verified." };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = "once-it-leaves-evidence.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function render() {
    const inLibrary = library.view === "library";
    $("libraryScreen").hidden = !inLibrary;
    $("progress").hidden = inLibrary;
    $("uploadScreen").hidden = inLibrary || state.stage !== "upload";
    $("passportScreen").hidden = inLibrary || state.stage !== "passport";
    $("mapScreen").hidden = inLibrary || state.stage !== "map";
    if (inLibrary) { renderLibrary(); return; }
    updateCharacters();
    for (const [id, active, done] of [["stepUpload", state.stage === "upload", state.stage !== "upload"], ["stepPassport", state.stage === "passport", state.stage === "map"], ["stepMap", state.stage === "map", false]]) {
      $(id).classList.toggle("active", active); $(id).classList.toggle("done", done);
    }
    if (state.stage === "upload") renderUpload();
    if (state.stage === "passport") renderPassport();
    if (state.stage === "map") renderMap();
  }
  function selectStop(category) { if (state.stage !== "map" || !observationsFor(category).length) return; selectedCategory = category; renderMap(); $("eventPanel").querySelector("h3")?.focus(); }
  $("assetInput").addEventListener("change", event => chooseFile(event.target.files?.[0]));
  $("chooseFileButton").addEventListener("click", () => $("assetInput").click());
  $("replaceFileButton").addEventListener("click", () => $("assetInput").click());
  $("continueButton").addEventListener("click", () => { if (!file) return; state.stage = "passport"; save(); render(); $("passportTitle").focus(); });
  $("backToUploadButton").addEventListener("click", () => { state.stage = "upload"; save(); render(); $("uploadTitle").scrollIntoView({ behavior: "smooth" }); });
  $("creator").addEventListener("input", () => { state.passport.creator = $("creator").value.trim().slice(0, 60); save(); updatePassportPreview(); });
  $("creatorNextButton").addEventListener("click", () => { state.passport.creator = $("creator").value.trim().slice(0, 60); if (!state.passport.creator) { $("packingError").textContent = "Give your traveler a creator name or alias first."; $("packingError").hidden = false; $("creator").focus(); return; } state.passportPhase = 1; save(); renderPassport(); $("packingQuestion").focus(); });
  $("passportChoices").addEventListener("click", event => { const button = event.target.closest("[data-pref]"); if (!button) return; const key = button.dataset.pref, value = button.dataset.value; if (!valid[key]?.includes(value)) return; state.passport[key] = value; state.passportPhase = Math.min(4, state.passportPhase + 1); save(); renderPassport(); $("packingQuestion").focus(); });
  $("previousPackingButton").addEventListener("click", () => { state.passportPhase = Math.max(0, state.passportPhase - 1); save(); renderPassport(); $("packingQuestion").focus(); });
  $("releaseButton").addEventListener("click", () => { if (!file || !state.passport.creator || state.passportPhase !== 4) return; state.stage = "map"; selectedCategory = null; save(); render(); $("mapTitle").focus(); });
  for (const category of categories) $(category + "Stop").addEventListener("click", () => selectStop(category));
  $("eventPanel").addEventListener("click", event => { if (event.target.closest("[data-close]")) { selectedCategory = null; renderMap(); } });
  $("evidenceForm").addEventListener("submit", addObservation);
  $("journalList").addEventListener("click", event => { const button = event.target.closest("[data-remove-id]"); if (!button) return; state.observations = state.observations.filter(item => item.id !== button.dataset.removeId); if (selectedCategory && !observationsFor(selectedCategory).length) selectedCategory = null; save(); renderMap(); evidenceMessage("Sighting removed."); });
  $("exportEvidenceButton").addEventListener("click", exportEvidence);
  $("searchCommonsButton").addEventListener("click", searchCommons);
  $("copyHashButton").addEventListener("click", async () => { if (!state.asset?.sha256) return; try { await navigator.clipboard.writeText(state.asset.sha256); $("copyHashButton").textContent = "Copied"; } catch { $("copyHashButton").textContent = "Copy unavailable"; } });
  const zone = $("dropZone"); for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add("dragover"); }); for (const type of ["dragleave", "drop"]) zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove("dragover"); }); zone.addEventListener("drop", event => chooseFile(event.dataTransfer?.files?.[0]));
  $("resetButton").addEventListener("click", () => {
    library.view = "library"; clearObjectURL(); file = null; save(); render();
    $("libraryTitle").focus();
  });
  $("newTravelerButton").addEventListener("click", startNewJourney);
  $("libraryGrid").addEventListener("click", async event => {
    const open = event.target.closest("[data-open-id]");
    if (open) { await openJourney(open.dataset.openId, open.dataset.openTarget); return; }
    const remove = event.target.closest("[data-remove-asset]");
    if (!remove) return;
    const journey = library.assets.find(item => item.id === remove.dataset.removeAsset);
    if (!journey || !confirm(`Remove ${journey.asset.name} and its diary from this browser?`)) return;
    library.assets = library.assets.filter(item => item.id !== journey.id);
    if (library.activeId === journey.id) library.activeId = null;
    if (state.id === journey.id) state = blank();
    save(); await deleteFile(journey.id);
    if (journey.id === "legacy-current") await deleteFile("current");
    renderLibrary();
  });
  $("signedFileInput").addEventListener("change", event => chooseFile(event.target.files?.[0], true));
  async function init() {
    if (library.view === "library" || !state.asset) { render(); return; }
    await openJourney(state.id, "map");
  }
  init();
})();
