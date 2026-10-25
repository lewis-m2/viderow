# Rowing Video Coach

A free web app (PWA) for a rowing coach to analyse crew videos on an **Android phone in Chrome**, installed to the home screen. Load a normal-speed phone video, slow it down, step frame by frame, zoom, draw lines and angles, then share snapshots or a recorded breakdown to athletes via WhatsApp. Videos never leave the phone.

The user is a rowing coach, comfortable with Flutter and sideloading Android apps, not a full-time developer. Explain decisions in plain language.

## How to work on this project

- Build **one milestone at a time** (see Milestones). At the end of each, stop and ask the user to test on their phone before starting the next.
- **Milestone 2 is a decision gate**: if frame stepping isn't smooth on real footage, stop and discuss moving to Flutter before building further.
- Target device: Android phone, latest Chrome. Desktop Chrome is fine for development, but phone behaviour is what counts.
- Keep dependencies minimal. Everything must be free and open source.
- No accounts, no servers, no uploads, no analytics.
- Commit at the end of each working step with a clear message.

## Testing on the phone

- Run the dev server with `vite --host`.
- Chrome only allows the microphone, sharing, installing and WebCodecs (the frame cache) on secure pages. A plain `http://192.168.x.x` address is **not** secure. The user may use any of these; set up both 1 and 2 in milestone 0:
  1. **Wi-Fi (everyday building):** self-signed certificate via `@vitejs/plugin-basic-ssl`, open `https://<computer-ip>:5173` on the phone and accept the warning once. Live reload, no cable.
  2. **Debugging (when something breaks on the phone):** USB debugging + desktop Chrome `chrome://inspect` → Port forwarding `5173 → localhost:5173`, then open `http://localhost:5173` on the phone. Phone console errors show on the desktop. Android 11+ "Wireless debugging" (paired with `adb pair` / `adb connect`) gives the same without a cable.
  3. **Real-world checks (end of each milestone, on the water):** the deployed HTTPS link, installed to the home screen.
- Production: GitHub Pages or Cloudflare Pages (HTTPS), auto-deployed from the repo.

## Stack

| Part | Choice |
|---|---|
| Language | TypeScript |
| Screens | Preact |
| Build | Vite |
| Playback | HTML `<video>` + `requestVideoFrameCallback` |
| Frame stepping | WebCodecs `VideoDecoder` + mp4box.js; decode a few seconds around the paused point into an in-memory frame cache (ImageBitmaps). Fallback: seek-based stepping for videos the cache can't decode (e.g. HEVC on some phones). |
| Drawing | `<canvas>` overlay; drawings stored in **video pixel coordinates** so they stay attached through zoom/pan |
| Zoom/pan | Pointer events, one CSS transform applied to video + canvas together |
| Snapshot | Render current view (zoom + drawings) to canvas → JPEG |
| Recording | `canvas.captureStream()` of a compositing canvas (video + drawings only, no UI) + optional mic via `getUserMedia`, `MediaRecorder`; prefer MP4 when `MediaRecorder.isTypeSupported` allows, else WebM |
| Sharing | Web Share API with files + text (Android share sheet → WhatsApp) |
| Storage | IndexedDB via `idb-keyval`; call `navigator.storage.persist()` |
| PWA | `vite-plugin-pwa` (manifest, service worker, offline) |

## Decisions (agreed with the user)

**Video**
- Videos are filmed at **normal speed** (typically 30 or 60 fps), not slow-mo. Max length about **2 minutes**.
- Speeds: 1×, ½×, ¼×, ⅛×.
- Show frame number and time (e.g. `Frame 3,210 / 7,080 · 0:53.50`).
- Both a **drag-to-scrub strip** (small drags = single frames) and **frame back/forward buttons** (hold to repeat).
- **No** bookmarks, **no** tags for crews or athletes, **no** A–B loop required. (Compare uses "A" and "B" for its two videos — unrelated to looping.)

**Layout**
- Portrait and landscape; **rotating the phone switches layout**.
- Landscape: tool rail on the left, video in the middle, controls panel on the right. The right panel **collapses** (» button) to give the biggest video; collapsed, the essentials (play, frame step, draw tool, undo, snapshot, record, « to expand) sit in the spare space beside the video, and a slim scrub bar over the bottom of the video **fades after ~3 s unused** and returns on tap.

**Zoom**
- Pinch to zoom (about 1× to 5×), two-finger drag to pan, **double-tap to reset**, − / + buttons.
- **No** reset button, **no** mini-map.
- Zoom **stays locked** while playing and stepping.
- One finger never zooms; two fingers never draw.
- **Pan mode** (the default tool, was "Move"): one finger pans the zoomed picture; drawings can't be grabbed. **Drawing tools**: one finger draws. Drawings are **never moved or edited** once made (so a new drawing can start on an old point); the **Erase** tool removes a drawing by tapping/dragging over it (one gesture = one undo step). Two fingers pinch/pan in every mode. (Agreed 2026-10-25; replaces the earlier move/edit tool.)
- Home has a **How to use** button with a short controls guide (keep it up to date when controls change).

**Drawing**
- Tools: pan, line, arrow, freehand, **one angle tool (tap 3 points; angle measured at the middle point, 0–180°, shown with an arc and a degree label)**, undo, clear all (with confirm), colour (yellow, cyan, pink, white), thickness (thin, medium, thick).
- A zoom bubble (loupe) shows under the finger while placing points.
- Each drawing is set to **this frame only** or **whole video**.
- Built (milestone 4, revised after phone test): new drawings default to **whole video**; line widths and labels stay the same size on screen at any zoom; the drawing canvas sits outside the zoom layer and maps video coordinates through the zoom. Long-press on the video must never show Chrome's video menu (zoom layer has `pointer-events: none`, contextmenu blocked). Landscape: left rail = Move/Line/Angle/Draw/Arrow/Undo/Clear/Colour + a button to slide the rail away (a pen tab on the video brings it back); the back/home button lives in the right panel (and the collapsed column), not the rail, so it isn't mistaken for hiding tools.

**Snapshots and sharing**
- Snapshot = exactly what's on screen, **at the current zoom**, with drawings.
- Optional note; shared together with the image so it becomes the WhatsApp caption. If WhatsApp drops the text, also copy the note to the clipboard.
- Save to gallery; collect several snapshots and share them together.
- **No** crew/date stamp on images.
- Direct send to a specific WhatsApp contact without the share sheet is not possible for free (needs WhatsApp's paid business system) — don't try.

**Recording**
- Records **only the video + drawings area** (not the buttons), including zoom, scrubbing, speed changes and drawing as they happen.
- **Optional voice** (mic on/off button).
- Timer shows `0:12 / 2:00`; stops automatically at **2 minutes**.
- Then share (WhatsApp) or save to gallery.

**Compare two videos** (A = today, B = a reference/"good" version or an earlier session)
- Purpose: show an athlete the difference between good technique and what's happening now, or show improvement between two sessions.
- Start: a **Compare** button on the analyse screen opens the current video as A and asks for B (★ references first, then recent list, then gallery). **Swap A/B** available.
- **Default: each video moves on its own.** Each has its own scrub strip and frame back/forward buttons, always visible. Crews in the two videos are usually rowing at **different stroke rates**, so the coach matches phases by hand (catch to catch, finish to finish). This independent mode is the main way compare is used.
- **Link is optional:** when both videos are at the same moment, tapping **Link** stores a time offset (B time − A time); then shared play, scrub, frame-step and speed drive both. Sync by **time, not frame number**, so 30 and 60 fps videos still match. Expected to drift over longer clips at different rates — **Unlink**, re-line up, link again. Frame stepping when linked: step A by one frame, show B's nearest frame at the matching time.
- **Build it simply and test on real footage first.** The user wants to see how compare works in practice before adding extras (e.g. no automatic stroke matching).
- **★ Reference videos:** any video can be starred as a reference (e.g. a few clips of really good technique). Starred videos show a ★ Reference label in the recent list and appear first when picking B. Starred videos are never auto-cleared.
- **Stacked (main view, portrait):** A on top, B below, each full width. Each video has its own zoom/pan. Drawing tools act on the video you touch; each video keeps its own drawings (stored with that video).
- **Side by side (landscape):** rotating the phone in compare puts A and B side by side, with the linked controls along the bottom.
- **Overlay / ghost (second phase):** B drawn semi-transparently over A, with a **See-through** slider (0–100 %) and an **Align B** mode where drag/pinch moves and scales only B so it sits over the boat. Only useful when both videos were filmed from a similar spot and distance. Stacked/Overlay toggle at the top of the compare screen (portrait).
- Snapshot in compare = one image containing both videos as shown (stacked A over B, side by side, or the overlay), drawings and zoom included. Recording in compare = the same area as a clip, with optional voice.
- Memory: two videos means two frame caches — halve the cache window for each.
- When linked, both play at the same speed.

**Recent videos**
- Home screen: big "Open video" button (from gallery) and a list of recent videos, each with its drawings saved on the phone (a stored copy of the video + drawing data in IndexedDB). Allow deleting old ones to free space.
- Note to user: clearing Chrome's site data wipes this list; originals stay in the gallery.

## Design

Dark UI, high contrast, big touch targets (≥ 44 px, ideally 48+), usable with wet fingers in a coach boat.

| Token | Value |
|---|---|
| Background | `#0E1116` |
| Surface | `#191E26` |
| Surface raised / selected | `#2A323E` |
| Text | `#F2F4F7` |
| Text muted | `#9AA4B2` |
| Accent (play, selected speed, primary buttons) | `#FF8A3D` (text on it `#111`) |
| Record / destructive | `#FF4D4F` |
| Drawing colours | yellow `#FFD60A`, cyan `#4CC9F0`, pink `#FF6FD8`, white `#F2F4F7` |
| Font | Inter, falling back to system sans-serif |
| Radius | 10–14 px controls, 20 px panels |

Icons: simple stroke icons (inline SVG), no emoji.

Screens (portrait unless noted):
1. **Home** — title, big orange "Open video / From Files › DCIM › Camera" button (Android's file chooser; secondary "Use photo picker instead"), recent videos list (thumbnail, name, ★ Reference label if starred, length, number of drawings/snapshots; star/unstar from the item), footer "Videos stay on your phone. Nothing is uploaded."
2. **Analyse** — top bar (back, video name, fps/length, Compare button, snapshot button, Rec button); video; frame/time row; timeline; scrub strip; playback row (frame back, big round play, frame forward); speed selector; bottom tool tray (Move, Line, Angle, Draw, Arrow, Undo, Clear, Colour).
3. **Drawing / angle options** — panel with *This frame only / Whole video*, colour swatches, thickness, list of drawings on the frame (with values like "Knee angle 93°", delete each), Clear all.
4. **Snapshot** — preview, note box ("sent as the WhatsApp caption"), strip of snapshots this session with "Share all", Save and Share buttons.
5. **Recording** — red `REC 0:12 / 2:00` pill, Voice on/off, Stop; red outline round the recorded area; playback and drawing tools still usable.
6. **Landscape analyse** — left tool rail, video, right panel (hide »; snapshot; record; speeds 2×2; frame back / play / forward; zoom − 1× +).
7. **Landscape collapsed** — as described under Layout.
8. **Compare: stacked, each on its own (default)** — two stacked 16:9 videos (labels "A · Today" in orange, "B · Reference" in cyan), each with its own frame back / scrub strip / frame forward and its time, Swap A/B in the top bar, hint "Slide each video to the moment you want to compare — catch to catch, finish to finish", bottom row: snapshot, drawing tools, Link.
9. **Compare: stacked, linked (optional)** — top bar (back, Stacked|Overlay toggle, snapshot, record); A above B with a thin gap, each with label and time; "Linked · both move together" row with Unlink; one shared scrub strip, frame back / play / frame forward, speeds; compact tool tray (Line, Angle, Draw, Arrow, Undo, Clear).
10. **Compare: overlay** — one larger video with B ghosted on top; See-through slider (A ↔ B); Align B and Swap A/B buttons; linked row; shared playback controls.
11. **Compare: landscape side by side** — A and B side by side across the top; below, back, Linked, shared scrub strip and both times; then speeds, frame back / play / forward, drawing tools, snapshot, record.

## Milestones

0. **Setup** — Vite + TS + Preact project, GitHub repo, HTTPS hosting with auto-deploy, PWA manifest/icon/service worker, base styles. *User checks:* installs to home screen and opens full screen.
1. **Load and play** — open video from gallery, read fps and frame count, play/pause, speeds, timeline with frame/time, portrait + landscape layouts, collapsible landscape panel. *User checks:* a real crew video plays slowly in both orientations.
2. **Frame stepping (decision gate)** — frame buttons (hold to repeat), scrub strip, WebCodecs frame cache, seek-based fallback. *User checks:* stepping through a catch is smooth → stay web, or discuss Flutter. **Passed 2026-10-24 on the user's Samsung: stepping forward/back and the scrub strip work well → staying web.**
3. **Zoom and pan** — pinch, two-finger pan, double-tap reset, − / +, zoom locked during playback, gesture separation. *User checks:* can follow one seat through a stroke.
4. **Drawing** — drawing model in video coordinates, line/arrow/freehand, 3-point angle, loupe, colours, thickness, frame-only vs whole-video, move/edit, undo, clear all. *User checks:* measures back and knee angles on real footage.
5. **Snapshots and sharing** — capture current view, note, Web Share to WhatsApp, save, share several. *User checks:* athlete receives image + note.
6. **Recording** — compositing canvas, optional mic, 2-minute cap, MP4 if supported, share/save. *User checks:* clip plays in WhatsApp on an athlete's phone.
7. **Recent videos and finishing** — IndexedDB storage of videos + drawings, recent list, delete, `storage.persist()`, fading scrub bar, offline, polish. *User checks:* a full session on the water.
8. **Compare (stacked + side by side)** — ★ star references, pick B, independent scrub/step per video (the default), optional Link by time offset, per-video zoom and drawings, landscape side by side, snapshot and recording of both. Keep it simple; the user will test on real footage and decide what to change. *User checks:* match a reference catch against today's crew by sliding each video, and send the comparison to an athlete.
9. **Compare overlay (ghost)** — B over A with see-through slider, Align B (move/scale B only), Stacked|Overlay toggle. *User checks:* overlay is useful on footage filmed from the same spot; if not, drop it.

## Known risks

- Backwards stepping laggy → frame cache; if still poor, Flutter.
- Android's photo picker (`accept="video/*"`) can hand Chrome a file it can't read (`NotReadableError`, file named like `1000062870`). Found on the user's Samsung in milestone 1 → the main Open button uses a file input with no `accept` (opens the Files chooser, which works); the photo picker is only a secondary option.
- HEVC videos may not decode via WebCodecs on some phones → seek fallback, or user turns off the camera's "high efficiency" setting.
- WhatsApp may drop text shared with an image → also copy note to clipboard.
- WebM recordings may not play in WhatsApp → prefer MP4.
- Bright sun readability → consider a high-contrast/bright mode toggle.
- Frame cache keeps only the visible area (plus 15% margin) at screen sharpness, re-decoded ~200 ms after zoom/pan stops; the real video is shown meanwhile. (User saw stepped frames go soft when zoomed with the old fixed 1280 px cache.)
- Memory → cache only a few seconds of frames; 2-minute video limit. Compare doubles this: halve each video's cache window.
- Compare with two videos decoding at once may be heavy on older phones → if linked playback stutters, play at the selected speed but update B from its frame cache rather than playing two `<video>` elements in parallel.

## Flutter fallback (only if milestone 2 fails)

Carries over: screens, decisions, drawing data format (video coordinates). Likely packages, to verify at the time: an mpv-based player such as media_kit for frame-exact stepping, `CustomPainter`, `InteractiveViewer`, share_plus. Recording a breakdown to video is the hardest part in Flutter.
