# Gotz.Puppyt Rig v2 — Comprehensive Spec Audit & Modular Roadmap (LLM-Agnostic)

> **Document Status**: Production Architectural Audit & Implementation Roadmap  
> **Source Bible**: `/Gotz.Puppyt.tsx` (Prototype 2 Spec Sheet & Canonical Rules)  
> **Target Implementation**: AI Studio Applet `7afcbc5d-452d-4df2-9a15-96f216906eec`  
> **Live Modules**: `src/rig/core.ts`, `src/rig/render.ts`, `src/rig/engine.ts`, `src/rig/art.ts`, `src/index.css`  
> **Baseline Policy**: Flag all discrepancies while strictly preserving the verified **Phase 3.A Stage & Interaction Locks** and **Phase 3.B Controls Locks** as the operational foundation.

---

## Part 1: Executive Summary & System Philosophy

### 1.1 Core Intent & Scope
The app is a parametric 2D cardboard cutout rig of the human hand inspired by Lotte Reiniger's silhouette animation aesthetics. It is **not** a loose 3D skeletal rig, **not** an AI image generator, and **not** a general paint/drawing program. Its purpose is to give artists and animators an intuitive, repeatable, locked-rule tool for **reference and pose-to-pose animation**, with clean export capabilities.

### 1.2 Two-Way Google Docs Sync Protocol (LLM-Agnostic)
`/Gotz.Puppyt.tsx` is the live local representation of the canonical Google Doc.
* **Continuous Sync**: All prompt batches, specifications, and completed phase outcomes are designed to be copied between any AI coding engine, developer, the local workspace, and the Google Doc.
* **Single Source of Truth**: When completing an incremental phase or locking a new parameter, `/Gotz.Puppyt.tsx` must be updated directly alongside code changes, allowing seamless copy-pasting back into Google Docs so all collaborators and engines remain in lockstep.
* **Agnostic Architecture**: The project avoids tool-specific harnesses, proprietary agent dependencies, or closed integrations. All instructions, data formats, and code patterns are standard TypeScript/React and portable across any coding model or environment.

### 1.3 Current State of the Rig
* **Phase 1 (Purpose)**: Signed off.
* **Phase 2 (Canonical Hand & Math)**: Core bone vectors and proportions implemented.
* **Phase 3.A (Stage & Interaction)**: **Fully Implemented & Verified**:
  - Tight hit targets ($r=0.20$ wrist hub with $0.18$ ring; $r=0.16$ joint pins; $r=0.18$ fingertips; centered inset bone rect shafts with zero double-hit jitter).
  - Joint dot pins knuckle angles; bone shaft drag drives tip IK solver with 51/49 child priority.
  - Per-finger IK toggles and whole-hand IK mode.
  - Viewport framing freeze during drags, zero jitter, camera Y-pan drop when wrist rotates past $-75^\circ$ in expert/elastic modes.
  - Split element removed for full-bleed viewport performance; matrix inversions cached per drag gesture.
* **Phase 3.B (Finger Rig Controls)**: **Fully Implemented & Verified**:
  - Wrist deduplicated: Canvas hub + unified Posing Wheel widget (rotary dial + 4 snaps + embedded fine slider) are the twin synced drivers; redundant tertiary sliders removed.
  - Splay deduplicated: 1 Master hand splay slider in Precise Pose Controls + 4 per-finger splay adds (Middle bird is 0 anchor).
  - Curl tiers locked: Tip IK drag + Master Curl slider + 3-joint collapsible drawer, with ±15° toolbar buttons as single-click quick step nudges.
  - Middle (Bird) styled with distinct `MASTER` badge and accent container border.
* **Remaining Phases (3.C through 4)**: Ready for structured, single-phase execution.

---

## Part 2: Comprehensive Audit (Spec Document vs. Live Codebase)

### Section 2: Kinematics & Mathematical Constants

| Parameter | Spec Document (`Gotz.Puppyt.tsx`) | Live Codebase (`src/rig/core.ts`) | Discrepancy & Status |
| :--- | :--- | :--- | :--- |
| **Middle (Bird) BONES** | `[4, 2, 1, 1]` (SUM = 8) | `[4, 2, 1, 1]` (SUM = 8) | **Exact Match** ✅ |
| **Ring BONES** | `[3.75, 1.875, 0.9375, 0.9375]` (SUM = 7.5) | `[3.75, 1.875, 0.9375, 0.9375]` (SUM = 7.5) | **Exact Match** ✅ |
| **Index BONES** | `[3.75, 1.875, 0.9375, 0.9375]` (SUM = 7.5) | `[3.75, 1.875, 0.9375, 0.9375]` (SUM = 7.5) | **Exact Match** ✅ |
| **Pinky BONES** | `[3.5, 1.75, 0.875, 0.875]` (SUM = 7) | `[3.5, 1.75, 0.875, 0.875]` (SUM = 7) | **Exact Match** ✅ |
| **Thumb BONES** | `[2, 1, 1, 1]` (4 segments, SUM = 5) | `[2, 1, 1, 1]` (4 segments, SUM = 5) | **Exact Match** ✅ |
| **Knuckle Overlap (`KN`)** | Spec text cites `0.05` (5px buffer intent) | `middle: 1, ring: 1, index: 1, pinky: 1, thumb: 0.5` | **Discrepancy (Intentional)**: Phase 3.A lock explicitly mandated retaining `KN = 1 / 0.5` to prevent overlap geometry collapse. Baseline maintained. |
| **Splay Anchors (`LIM`)** | `thumb: -120, index: -30, middle: 0, ring: 30, pinky: 60/90` | `thumb: -120, index: -30, middle: 0, ring: 30, pinky: 60` | **Aligned**: Pinky is locked to $60^\circ$ for natural spread; asymmetric swivel handled in `rRange`. |
| **Swivel (`rRange`)** | Controlled rigid ($\pm 4^\circ, \pm 6^\circ, \pm 8^\circ, \pm 11^\circ, \pm 75^\circ$) | Baseline $\pm 75^\circ$, thumb $\pm 75^\circ/\pm 90^\circ$, pinky $[-24^\circ, 28^\circ] \to [-24^\circ, 90^\circ]$ with progressive stiffness | **Discrepancy (Intentional)**: Upgraded in Phase 3.A Lock Q2 for tactile, responsive finger posing. |
| **Curl (`cRange`)** | Default: $[-20^\circ, 90^\circ]$ (thumb $[-20^\circ, 80^\circ]$), Expert: $[-90^\circ, 90^\circ]$ | Default: $[-20^\circ, 90^\circ]$ (thumb $[-20^\circ, 80^\circ]$), Expert: $[-90^\circ, 90^\circ]$ | **Exact Match** ✅ |
| **Width Scaling (`wid`)** | `0.75 * SUM/8` (thumb $\times 0.9$), `wscale` applies `(SUM - KN)/7` | `baseW * scale`, `wscale` applies `((SUM[d] - KN[d]) / 7)` | **Exact Match** ✅ |
| **Bend Direction (`BEND`)** | Thumb $-1$, others $+1$ | Thumb $-1$, others $+1$ | **Exact Match** ✅ |
| **Metacarpal Hub** | Virtual wrist at $[0, -7.0]$ functional | Wrist at $[0, 0]$ with chain root at functional hub | **Exact Match** ✅ |

---

### Section 3.A: Stage & Interaction Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Action |
| :--- | :--- | :--- | :--- |
| **Wrist Hub** | Tight hit $r \approx 0.2$, $\pm 75^\circ$ default $\to$ $360^\circ$ toggle | Rendered at $r=0.20$ with $0.18$ ring. Clamped to $[-75^\circ, 75^\circ]$ default $\to$ $[-180^\circ, 180^\circ]$ on expert/elasticity. | **Complete & Verified** ✅ |
| **Bone vs. Joint Hit Splitting** | Centered hit-targets, no double-hit jitter, pin vs. tip IK | Joint pins ($r=0.16$) pin knuckle angle; bone rect shafts are inset ($y_{top} + 0.16$, height $-0.32$) and drive tip IK. 51/49 child priority. | **Complete & Verified** ✅ |
| **Viewport & Framing** | Centered, zero-jitter, frozen during drag, no split layout | `fit()` freezes during drags, recalculates only when idle; camera Y-pan drop when wrist $<-75^\circ$; `#split` removed; full bleed. | **Complete & Verified** ✅ |
| **Matrix Inversion** | Screen CTM inverse cached per drag, not stale on resize | CTM inverse cached on `pointerdown`, refreshed on `ResizeObserver`. | **Complete & Verified** ✅ |

---

### Section 3.B: Finger Rig Controls Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Action |
| :--- | :--- | :--- | :--- |
| **Wrist Writers** | Deduplicate: Exactly one primary source of wrist rotation | Stage hub drag + unified Posing Wheel widget (dial + 4 snaps + fine slider) are synced twin drivers. Tertiary sliders removed. | **Complete & Verified** ✅ |
| **Splay Writers** | Deduplicate: Master splay + per-finger offsets | 1 Master splay slider in drawer + 4 individual splay offsets (Middle bird has 0 anchor). | **Complete & Verified** ✅ |
| **Curl Writers** | Maximum 2 ways to curl: Drag tip IK on canvas + 1 joint slider set | Tip drag IK on canvas + Curl (all) master slider + collapsible 3-joint sliders. Quick `±15°` buttons act as single-click nudges. | **Complete & Verified** ✅ |
| **Middle (Bird) Master UI** | Master reference digit gets clear visual distinction | Middle digit styled with `.master-digit` border and `MASTER` badge in UI. | **Complete & Verified** ✅ |

---

### Section 3.C: Pose Library Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **Pose Selectors** | Single clean pose picker (cut Quick 8 + Library + chips triple) | App currently has Quick list on left toolbar (`$quickList`), Library drawer (`#lib`), and chips selector. | **Redundant**: Unify into a single high-efficiency Pose Drawer with quick-access favorites bar. |
| **Auto-Name Collision** | `$name` auto-increment without overwriting custom poses | Poses can collide or overwrite when names like `Pose 1` repeat. | **Action**: Implement collision-proof naming helper (`Pose ${n}` checking existing keys). |
| **Canonical vs. Custom Guard** | Protect default/canonical poses from accidental deletion | Delete button currently active across all poses if selected. | **Action**: Disable Delete button for built-in canonical poses; enable only for user-created poses. |
| **JSON Export/Import** | Full roundtrip: state shape serialization and validation | Implemented, but needs explicit schema migration guard for new Phase 3.A properties (`ikPerFinger`, `wholeIk`). | **Action**: Update `cleanPose()` and JSON import to validate all Phase 3.A fields. |

---

### Section 3.D: Visual System Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **Skin Art vs. Boxes** | Cohesive matrix: Skin art, Structural bones, Palm boxes | Implemented (`skinPath` vs `structuralBonePath`), but box rect uses SVG dasharray rather than CSS classes. | **Action**: Normalize SVG box rect styling to CSS class rules (`.box`); ensure buff overlap rects hide when skin art is active. |
| **Bend Indicator Legend** | Visual explanation of flexion/extension arrows | Flexion (lime) and extension (red/cyan) bend marks render without an on-screen legend. | **Action**: Add a subtle, collapsible HUD legend for flexion/extension indicator arcs. |
| **Theme Controls** | Labeled Dark/Light toggle, not cryptic icons | Button uses `[SUN]` / `[MOON]`. | **Action**: Update theme toggle to explicit labeled states ("Dark" / "Light"). |

---

### Section 3.E: Builds Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **Build Types** | 4 builds: Standard (5), Claw (2: thumb+index), Trident (3: thumb+ring+middle), Mickey's Glove (4: thumb+index+middle+ring) | All 4 builds defined in `core.ts`. | **Aligned** ✅ |
| **Selector Redundancy** | Single build picker | Build cycler button in toolbar + build buttons in settings drawer. | **Redundant**: Consolidate to a single segmented build selector. |
| **Inactive Digits (`.off`)** | Inactive digits must not respond to pointer events or generate hit targets | Currently rendered with CSS `.off` opacity, but hit rects could still intercept pointers if not explicitly filtered. | **Action**: Ensure `getActiveFingers(st.build)` completely skips generating `.hit` targets for inactive digits. |

---

### Section 3.F: Still Export Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **Single Export Pipeline** | Spacebar and Export button share identical rendering path | Spacebar triggers snap; image drawer has separate render logic. | **Action**: Extract unified `renderStillPNG(state, resolution)` pipeline shared by all export triggers. |
| **Feature Detection** | `CompressionStream` feature detection with graceful fallback | Direct usage of canvas/blob export without `CompressionStream` fallback check. | **Action**: Wrap PNG compression pipeline with standard `OffscreenCanvas` / `toBlob` fallback. |
| **Clipboard Security** | Clipboard copy guarded against non-secure contexts | Toast error if `navigator.clipboard` fails. | **Action**: Add secure context (`isSecureContext`) check before offering Copy button; fallback to direct download. |

---

### Section 3.G: Pose-to-Pose Animation Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **Filmstrip Safety** | Non-destructive preview: clicking a frame previews without overwriting current pose | Currently, selecting filmstrip frames can mutate working state. | **Action**: Implement explicit preview buffer: filmstrip scrub updates preview stage only; explicit "Apply Pose" button commits to working state. |
| **Frame Count & Defaults** | 6 frames between From and To poses | Supported in morph panel, but frame rate / duration bounds need clamp guards. | **Action**: Clamp duration ($0.2\text{s}$ to $10\text{s}$) and frame count ($\le 24$ frames) to prevent memory allocation spikes. |
| **Encoder Consolidation** | Native lightweight export without bloated custom LZW | GIF/APNG encoders exist in engine. | **Action**: Retain clean frame-by-frame PNG zip or lightweight gif generator; guard against OOM on long durations. |

---

### Section 3.H: State, History & Persistence Audit

| Feature | Spec Intent | Live Codebase Status | Discrepancy & Required Action |
| :--- | :--- | :--- | :--- |
| **State Immutability** | Pure immutable state transitions; no mutable god-object side-effects | Engine uses mutable `S = { ... }` with direct mutation and manual `commit()`. | **Action**: Wrap state mutations in an atomic reducer `dispatch(action)` or explicit `produce(S, draft)` pattern with clean undo/redo stack. |
| **Glide / Drag Commit** | Dragging or morphing must not commit half-states to history | Intermediate RAF moves sometimes push intermediate steps. | **Action**: Commit history boundary strictly on `pointerup` / `glideEnd`. |
| **Persistence Key** | Single versioned localStorage key | Key `pyxl.hand.v2` used with fallback to legacy. | **Action**: Standardize to `pyxl.hand.v2.state` and `pyxl.hand.v2.poses` with automatic migration. |

---

## Part 3: Discrepancy Resolution & Baseline Matrix

Reconciling the Spec Bible with the live locked build:

```
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Element                  | Gotz.Puppyt.tsx Spec  | Live Locked Rig       | Roadmap Standard                     |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Knuckle Overlap (KN)     | 0.05 (5px buffer)     | 1.0 (mid/ring/idx/pnk)| KEEP Phase 3.A Lock (1.0 & 0.5 thumb)|
|                          |                       | 0.5 (thumb)           | Overlap math relies on this geometry |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Metacarpal Swivel        | Controlled rigid      | Baseline ±75°         | KEEP Phase 3.A Lock                  |
| (rRange)                 | ±4°/±6°/±8°/±11°/±75° | Progressive stiffness | Ensures responsive tactile posing    |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Stage Split Bar          | 16px split, 20%-85%   | Dropped; full-bleed   | KEEP Phase 3.A Lock                  |
|                          |                       | stage with overlay    | High performance, zero layout thrash |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Hit Target Geometries    | Shaft hit r=w+0.5     | Inset rect + r=0.16   | KEEP Phase 3.A Lock                  |
|                          | Overlapping buffers   | pins + r=0.18 tips    | Solves double-hit jitter permanently |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
| Wrist Driver             | Slider + Wheel + Hub  | Twin drivers: Canvas  | KEEP Phase 3.B Lock                  |
|                          | Multiple writers      | Hub + Posing Wheel    | Clean, zero feedback loops           |
+--------------------------+-----------------------+-----------------------+--------------------------------------+
```

---

## Part 4: Modular Execution Roadmap (LLM-Agnostic Specifications)

Each specification below is self-contained and atomic. They can be executed by any AI coding model, assistant, or software engineer in sequence.

---

### System & Engineering Context
```text
You are the Lead Rigging and Frontend Engineer implementing the remaining phases of the Gotz.Puppyt Hand Rig v2 (Applet 7afcbc5d).
Core constraints:
1. Architectural Bible: /Gotz.Puppyt.tsx represents the project specification.
2. Verified Foundations: Do NOT revert Phase 3.A Stage & Interaction locks (KN remains 1.0/0.5, rRange remains baseline ±75° with progressive compliance, hit targets remain tight and non-overlapping, stage remains full-bleed without the split bar).
3. Verified Controls: Do NOT revert Phase 3.B Finger Rig Controls locks (twin wrist drivers, deduplicated splay, 3-tier curl access, Middle master badge).
4. Incremental Execution: Implement ONLY ONE phase per turn. Verify each phase with `npx tsc --noEmit` and `npm run build` before proceeding to the next.
5. Clean UI & Code: Standard TypeScript and Tailwind/CSS variables. No telemetry or console clutter.
6. Documentation Sync: Update `/Gotz.Puppyt.tsx` at the end of each completed phase with the finalized code numbers and signed-off status, ensuring seamless copy-pasting back into Google Docs.
```

---

### Phase 3.C: Pose Library & Storage Refactor

#### Task Specification & Prompt:
```text
Implement Phase 3.C: Pose Library for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/engine.ts`, `src/rig/core.ts`.

Tasks:
1. Single Pose Picker:
   - Merge the Quick 8 bar, Drawer Pose List, and chip filters into a unified, responsive Pose Library modal/drawer.
   - Provide a persistent quick-access favorites row for the top 5 canonical poses (Neutral Flat, Fist, Point, Open Relaxed, Thumbs Up).
2. Auto-Name Safety:
   - Update pose saving to auto-generate unique names (`Pose 1`, `Pose 2`, etc.) by checking existing keys in localStorage.
3. Deletion Protection:
   - Mark canonical built-in poses as read-only.
   - Only allow deletion on user-created custom poses.
4. Schema Persistence:
   - Ensure `cleanPose()` and `sanitizeHandState()` serialize all Phase 3.A fields (`ikPerFinger`, `wholeIk`, `fullElasticity`).
5. Verification:
   - Test saving a new pose, switching poses, importing/exporting JSON, and deleting custom poses.
```

#### Acceptance Checklist:
* [ ] Single cohesive pose management interface.
* [ ] Built-in canonical poses cannot be deleted or overwritten.
* [ ] Auto-naming generates monotonic, non-colliding names.
* [ ] JSON export includes full schema including IK flags.

---

### Phase 3.D: Visual System & Art Matrix

#### Task Specification & Prompt:
```text
Implement Phase 3.D: Visual System for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/render.ts`, `src/rig/engine.ts`, `src/index.css`.

Tasks:
1. Skin vs. Boxes vs. Structural Bones Interaction Matrix:
   - When `skin: true`: Render organic SVG skin paths (`skinPath`), hide seam buffers (`.buff`).
   - When `skin: false`: Render mechanical structural bones with flares and dome caps (`structuralBonePath`), show seam buffers.
   - When `boxes: true`: Render bounding pyxl guide boxes (`.box`) using clean CSS classes (`vector-effect: non-scaling-stroke`).
2. Flexion / Extension Bend Mark Legend:
   - Add a subtle toggleable HUD legend in the viewport corner explaining bend indicators: Lime arc = Flexion (closing curl), Cyan/Red arc = Extension (hyperextension).
3. Theme Labeling:
   - Ensure Theme toggle is clearly labeled (`Theme: Dark` / `Theme: Light`) with high contrast.
4. Verification:
   - Toggle skin art, palm boxes, and width scale in combination; verify SVG z-order and rendering crispness.
```

#### Acceptance Checklist:
* [ ] Seamless transition between Skin Art, Structural Bones, and Palm Boxes.
* [ ] SVG box outlines use CSS classes without attribute bugs.
* [ ] On-canvas bend mark legend added.
* [ ] Theme toggle clearly labeled.

---

### Phase 3.E: Builds Architecture & Interactivity Gating

#### Task Specification & Prompt:
```text
Implement Phase 3.E: Builds Architecture for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/core.ts`, `src/rig/render.ts`, `src/rig/engine.ts`.

Tasks:
1. Segmented Build Selector:
   - Provide a clean, accessible 4-way segmented selector for:
     * Standard (5 digits)
     * Claw (Thumb + Index)
     * Trident (Thumb + Middle + Ring)
     * Mickey's Glove (Thumb + Index + Middle + Ring)
2. Interactive Gating of Inactive Digits:
   - Ensure `handMarkup()` does not render SVG elements or `.hit` rects for inactive digits.
   - Inactive digit cards in the controls panel must be hidden or completely disabled from pointer interaction.
3. Verification:
   - Switch through all 4 builds; verify that dragging the canvas only interacts with active digits and does not throw errors.
```

#### Acceptance Checklist:
* [ ] Single 4-way build selector.
* [ ] Inactive digits completely omitted from SVG hit testing.
* [ ] Controls drawer reflects active digits only.

---

### Phase 3.F: Still Export Pipeline

#### Task Specification & Prompt:
```text
Implement Phase 3.F: Still Export Pipeline for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/engine.ts`, `src/rig/render.ts`.

Tasks:
1. Unified PNG Export Pipeline:
   - Create a single helper `renderStillPNG(state: HandState, size = 1024): Promise<Blob>`.
   - Wire both the Spacebar shortcut and the UI "Export PNG" button to this exact helper.
2. Compression & Fallback:
   - Implement standard `canvas.toBlob('image/png')` with `CompressionStream` feature detection where supported.
3. Clipboard Security:
   - Gate clipboard copying (`navigator.clipboard.write`) behind `window.isSecureContext`.
   - Provide direct file download when clipboard access is unavailable or denied.
4. Verification:
   - Export 1024x1024 transparent PNG from canvas; verify framing, alpha channel, and correct crop.
```

#### Acceptance Checklist:
* [ ] Shared single-source PNG export pipeline.
* [ ] Spacebar and UI button use identical output logic.
* [ ] Safe clipboard copy with automatic download fallback.

---

### Phase 3.G: Safe Pose-to-Pose Animation

#### Task Specification & Prompt:
```text
Implement Phase 3.G: Pose-to-Pose Animation for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/engine.ts`, `src/rig/core.ts`.

Tasks:
1. Non-Destructive Filmstrip Preview:
   - Ensure clicking filmstrip frame previews updates the temporary canvas view without overwriting or committing to the active working pose.
   - Add explicit "Commit Frame" button to apply a tweened frame to the editable state.
2. Tween Bounds & Safety:
   - Clamp frame count (default: 6 frames, max: 24 frames) and duration ($0.2\text{s}$ to $5.0\text{s}$).
   - Guard against out-of-memory errors by reusing temporary rendering contexts.
3. Seamless Interpolation:
   - Interpolate wrist rotation via shortest circular path (`norm(b - a)`).
   - Interpolate joint curls and splay linearly.
4. Verification:
   - Morph between Neutral and Fist; verify smooth playback, scrub responsiveness, and zero memory leaks.
```

#### Acceptance Checklist:
* [ ] Filmstrip preview is strictly non-destructive.
* [ ] Shortest-path angular interpolation for wrist and rotations.
* [ ] Frame and duration caps prevent memory exhaustion.

---

### Phase 3.H: State Reducer, History & Persistence

#### Task Specification & Prompt:
```text
Implement Phase 3.H: State Reducer & History for Gotz.Puppyt Hand Rig v2.
Target files: `src/rig/engine.ts`, `src/rig/core.ts`.

Tasks:
1. Atomic State Reducer:
   - Encapsulate all state modifications into an immutable transition pattern: `setState(nextState)`.
   - Manage undo/redo history with clear transaction boundaries (e.g., commit on `pointerup`, not on every RAF move).
2. Keyboard Shortcut Gating:
   - Gate Spacebar (export) and Ctrl+Z / Ctrl+Y (undo/redo) so they do NOT trigger when typing in text input elements (`INPUT`, `TEXTAREA`).
3. Clean Up Event Listeners:
   - Ensure all pointer and window listeners have matching cleanup disconnections.
4. Verification:
   - Perform 10 rapid drags, verify undo/redo traverses exact gesture boundaries without skipping or creating orphan states.
```

#### Acceptance Checklist:
* [ ] Single authoritative undo/redo manager.
* [ ] History commits occur on pointer release, preventing gesture flooding.
* [ ] Active text input typing does not fire rig shortcuts.

---

### Phase 4: Ship & Revision Loop

#### Task Specification & Prompt:
```text
Implement Phase 4: Final Polish & Revision Loop for Gotz.Puppyt Hand Rig v2.
Tasks:
1. Verify Build & Bundle:
   - Run `npx tsc --noEmit` and `npm run build` and ensure clean zero-warning compilation.
2. Synchronize Spec Documentation:
   - Ensure all updated parameters in `core.ts` are documented in `/Gotz.Puppyt.tsx`.
3. Provide a concise release summary of all completed modules.
```

---

## Part 5: Quality Assurance & Build Verification Protocol

Every phase must pass this automated verification before being declared done:
```bash
# 1. Type validation
npx tsc --noEmit

# 2. Vite Production Build
npm run build
```

---

*Roadmap and Audit compiled for Gotz.Puppyt Hand Rig v2 (LLM-Agnostic).*
