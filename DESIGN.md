---
name: Travel Footprints
description: A quiet gray atlas with small cyan place markers and compact travel records.
colors:
  page: "#1d1e20"
  ocean: "#232629"
  land: "#414145"
  map-border: "#252629"
  ink: "#dcdfe1"
  muted: "#92989d"
  paper: "rgba(30, 33, 36, .97)"
  card: "#292d31"
  line: "#3b3f43"
  soft: "#2b3034"
  point: "#70a9c0"
  accent: "#95bdd0"
  focus: "#7caac0"
  wish: "#d5b27a"
typography:
  body:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  title:
    fontSize: "15px"
    fontWeight: 500
  label:
    fontSize: "12px"
  wish-body:
    fontSize: "12px"
    lineHeight: 1.65
  wish-label:
    fontSize: "11px"
rounded:
  chip: "4px"
  control: "5px"
  navigation: "6px"
  media: "7px"
  overlay: "11px"
  marker: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
components:
  button-secondary:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  input-field:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  navigation-active:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.navigation}"
    padding: "8px 13px"
  month-chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "6px 8px"
  wish-button:
    textColor: "{colors.ink}"
    typography: "{typography.wish-label}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
  wish-button-primary:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.wish-label}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
  wish-search-field:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
  wish-marker:
    rounded: "{rounded.marker}"
    width: "6px"
    height: "6px"
  wish-visibility:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.wish-label}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
---

# Design System: Travel Footprints

## Overview

**Creative North Star: "A quiet personal atlas"**

The world map carries the visual weight. Dark gray land and water establish a restrained field; tiny cyan dots mark places without turning the map into a collection of oversized pins. Compact records sit in a collapsible panel, leaving the map available for exploration.

The photo dialog inherits this existing world: neutral surfaces, fine borders, modest curves, plain controls, and a cyan primary action. English is the default, with a Chinese toggle. This record describes the current source in `site/styles.css`, `index.html`, `site/app.js`, and `site/photo-upload.js`; it does not certify rendered quality or deployed upload behavior.

The public wishlist extends the same atlas with hollow champagne marks and compact destination records. Browsing, city search, and owner editing stay inside the existing panel; a separate map control keeps wishlist visibility available when that panel is collapsed. These additions follow `site/wishlist.css`, `site/wishlist-view.js`, and the wishlist integration in `site/app.js`.

**Key Characteristics:**

- Gray map surfaces with a restrained cyan accent.
- Small circular markers and compact, collapsible records.
- Shared neutral controls across browsing and photo preparation.
- Explicit state text alongside disabled controls.
- Hollow champagne wishlist marks alongside cyan visits.

## Colors

The frontmatter records the default dark theme using the stylesheet's own token names.

### Primary

- **Place cyan (`point`)** marks locations and timeline dots.
- **Action cyan (`accent`)** identifies actions, links, and hover emphasis.
- **Focus cyan (`focus`)** outlines keyboard focus.

### Secondary

- **Champagne wish (`wish`)** identifies wishlist rings, destination tags, search carets, and the display checkbox. Its light-theme override is deeper for contrast; secondary copy inside the light-theme wishlist panel also receives a stronger muted-ink override.

### Neutral

- **Page charcoal (`page`), ocean gray (`ocean`), and land gray (`land`)** separate the frame from the geographic field; `map-border` delineates countries.
- **Overlay charcoal (`paper`) and card gray (`card`)** support panels, dialogs, and tooltips.
- **Soft gray (`soft`) and divider gray (`line`)** distinguish selected controls, fields, rows, and boundaries.
- **Light ink (`ink`) and muted ink (`muted`)** separate primary content from secondary details.

The existing light theme remaps these roles through `body[data-theme="light"]`; components must continue using the CSS variables. Its primary upload button uses white text. Generated tonal ramps in the sidecar are display aids, not additional implemented palette tokens.

**The Quiet Accent Rule.** Keep the geographic field neutral; use cyan for places, actions, and focus.

**The Wishlist Accent Rule.** Reserve champagne for wishlist identity and its display control; wishlist actions retain the shared neutral surfaces and cyan keyboard focus.

## Typography

**Body Font:** Segoe UI, with PingFang SC, Microsoft YaHei, and sans-serif fallbacks.

The interface uses a compact reading hierarchy: body copy, medium-weight city and tooltip titles, and smaller control labels. City detail and upload headings are larger and lighter. The upload dialog uses more readable supporting copy (13px, 1.65 line height) than the map's compact utility labels; its fields increase to 16px on narrow screens. Dates use tabular numerals where the source specifies them. The existing brand display treatment is not promoted to a reusable display token.

Wishlist copy uses the compact `wish-body` and `wish-label` roles. Destination rows have medium-weight names (14px) above smaller country and region text (10px); detail titles are light and larger (29px, 1.2 line height). Reasons preserve line breaks, and list excerpts stop after two lines. Search and reason fields increase to a readable size (16px) at the map breakpoint.

## Layout

The map occupies the viewport beneath the header. On desktop, a narrow panel (320px) overlays its left edge; the initial state is collapsed. At the map breakpoint (760px), the header stacks and the panel becomes a bottom sheet capped at 46dvh. Photo tiles form two columns.

The upload dialog is centered, bounded (620px maximum intended width), and internally scrollable. A heading and close action lead into account state, visit month, the drop target, selected photos with captions, feedback, and actions. At its breakpoint (600px), padding contracts, photo rows and account controls wrap, and image previews shrink. Reuse the observed small spacing steps without imposing a new grid.

The wishlist reuses the desktop panel width and replaces its content with list, search, detail, or edit states. The labeled visibility checkbox sits outside the panel at the map's upper right. On narrow screens (760px and below), an open wishlist sheet is capped at 58dvh and the map controls sit above it with a 49px offset. Wishlist actions grow from a minimum height (36px) to a larger touch target (40px). Header controls tighten between 761px and 1100px and wrap on mobile, with further spacing reductions at 380px.

## Elevation & Depth

Tonal separation and single-pixel borders provide most depth. Panels, tooltips, and dialogs share the stylesheet's soft shadow; map controls and the panel opener explicitly remove it. The modal backdrop dims the map. Tiny marker glows exist only around locations and their interactive states. Navigation is immediate, and reduced-motion preferences suppress CSS animation and transitions.

**The Shared Surface Rule.** New overlays inherit the existing surface, border, and shadow tokens.

## Shapes

Controls use modest curves; chips are tighter, media and drop zones slightly softer, and panels and the upload dialog share the overlay radius. Markers remain circular. Rows are divided by fine rules instead of individually elevated cards. Dashed boundaries indicate photo placeholders and the upload drop target.

Wishlist rings have the same outer diameter as a resting visited dot (6px, border-box), including their fine outline (1px). They stay hollow, without a glow, and retain that diameter during hover, keyboard focus, and selection. The larger transparent button target (18px) remains separate from the visible mark. A visited destination also on the wishlist keeps one cyan dot with a champagne border.

## Components

### Buttons

Secondary upload buttons have a fine border and transparent ground; hover uses the soft surface and action color. The primary save button fills with action cyan. Upload actions have a minimum height (38px), while the album entry action is compact. Disabled controls use reduced opacity (0.4); keyboard focus uses the shared outline (2px, offset 3px).

### Chips

Visit-month chips use the soft surface, compact padding, and tabular dates. They are informational labels, not filters.

### Cards / Containers

City entries are full-width text buttons separated by bottom borders; hover adds a soft background. Photo thumbnails are cropped within a two-column grid. The upload queue uses thumbnail-and-caption rows with dividers, not a second card system.

### Inputs / Fields

The map search is embedded in a soft, bordered wrapper. Upload month and caption fields use the page surface, fine borders, and the control radius. The drop target is a real button, with an underlined file-picker action and a solid accent border while dragging. Errors use readable text within a neutral inset surface.

### Navigation

Cities, Timeline, and Overview share small rounded text controls; the active view uses the soft surface. The language control underlines the active language. The city panel can be hidden and reopened, and the map's zoom/world controls remain separate.

### Map Markers and Photo Dialog

Place dots remain small (6px) within larger button targets (18px); hover and focus increase the dot slightly, while selection adds a restrained ring. The upload dialog returns focus to its opener and preserves usable focus across rerenders. Feedback distinguishes local drafts, saving, repository save, and website publication.

With `site/upload-config.js` currently empty, the dialog displays **Local preview**, permits local image preparation, and disables saving. Owner GitHub sign-in and save/publication states exist in the implementation; no live service or cloud upload is verified by this document.

### Wishlist Browsing and Editing

Quiet destination records extend the map's existing panel and control language.

- **Public list and details:** divided full-width rows pair the small hollow mark with a destination name, country and region, and an optional reason excerpt. Details show the wishlist or revisit tag and the full public reason. The empty state uses the same small mark and a light heading.
- **City search:** a labeled, soft-surface field leads into Worldwide, China, and Elsewhere filters. Reviewed destination ideas appear before a query; city results keep their country and region visible and identify destinations already saved or visited. The active filter uses the shared soft surface and fine border. Loading, failure, and no-result states use explicit text and retry actions where available.
- **Owner editing:** sign-in gates saving, editing, and removal. The optional public reason stays inline in a resizable field with a character counter; removal asks for confirmation in the panel. Primary wishlist buttons remain neutral, using the soft surface and a stronger border. Busy controls disable actions while visible state text explains progress.
- **Visibility:** the native checkbox uses the wishlist accent and a hollow-mark legend. Its local display preference persists independently of the panel and saved destinations. When the marks are hidden, the wishlist panel explains the hidden state.
- **Focus and feedback:** search, detail, edit, and save transitions place focus on the relevant field, heading, or status. Rerenders preserve the active input, selection, and panel scroll where possible. Saving and confirmed publication are separate visible states; delayed publication offers a check action. Leaving a changed reason asks before discarding it.

## Do's and Don'ts

### Do:

- **Do** preserve the gray map, tiny cyan dots, and collapsible city panel.
- **Do** reuse CSS color variables so controls follow both existing themes.
- **Do** retain English and Chinese labels, visible focus, and explicit state text.
- **Do** keep wishlist rings equal in outer size to resting visited dots, including their border.
- **Do** keep the wishlist visibility control usable while the city panel is collapsed.

### Don't:

- **Don't** introduce a separate visual identity for the upload dialog.
- **Don't** replace small place dots with oversized pins.
- **Don't** present local previews or repository saves as confirmed website publication.
- **Don't** fill or enlarge unvisited wishlist rings during hover, focus, or selection.
- **Don't** give wishlist search and owner editing a separate overlay or visual identity.
