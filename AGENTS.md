# AGENTS.md

Working notes for any coding agent editing this repository.

## What this is

A single-file offline-first PWA that calculates agrochemical dosage for
agricultural spray drones, using DJI Agras tank capacities as the baseline.
Built for Malaysian durian growers and spray contractors. Trilingual:
Chinese (default), English, Malay.

Deployed as static files on GitHub Pages. There is no build step, no bundler,
no package.json, no framework. **Do not introduce one.** `index.html` is
hand-edited and served as-is. Adding Vite/React/TypeScript to this project
breaks the deployment workflow it was designed around.

## Files

| File | Role |
|---|---|
| `index.html` | The entire app — markup, CSS, i18n strings, logic |
| `sw.js` | Service worker, network-first |
| `manifest.webmanifest` | PWA manifest |
| `icon-*.png` | App icons |
| `make_icons.py` | Regenerates the icons (Pillow) |
| `test/dose.test.js` | Dosage math regression test |

## Before you commit

```
node test/dose.test.js
```

No dependencies. It extracts the calculation core from `index.html` and runs
47 checks. It must pass. If you change the banner comments
`/* ===================== number helpers` or `/* ===================== rendering`,
update the markers at the top of the test.

If you change dosing behaviour deliberately, change the test in the same
commit and say why. Do not delete a failing check to make the suite green.

**Bump `CACHE` in `sw.js` on every deploy**, or returning users keep the old
cached build.

## Correctness rules — these are the point of the app

1. **Dose is always computed per unit area, never by concentration.**
   A drone applies roughly 6–30 L/acre; a 过山泵 (high-pressure power pump)
   applies several hundred. Mixing to a knapsack label's concentration in a
   drone tank under-doses by a factor of tens. The label-per-tank and ratio
   modes exist solely to convert those labels into a per-acre rate first.
   Never add a code path that puts a label concentration directly into the
   drone tank.

2. **Never invent agronomic data.** No built-in product list with dose rates,
   no default rates for named chemicals, no PHI/re-entry intervals. The
   operator's label is the authority. The spray-volume presets (6/12/20/30
   L/acre) are labelled in the UI as operator starting points, not
   recommendations — keep that framing. The 800 L/acre conventional default
   is presented as an arithmetic example (40 trees x 20 L), not a fact.

3. **Fail loudly, never silently.** Zero or missing area, spray volume or
   tank must block the mixing sheet with a stated reason. Never substitute a
   default and print a confident number. A farmer acting on a silently wrong
   sheet sprays a whole block wrong.

4. **Conservation of mass.** Per-load volumes must sum to the total spray
   volume, and per-load product must sum to the total product, in both split
   modes. The test enforces this; keep it enforced.

5. **Show the concentration multiplier.** Farmers must see how much stronger
   the drone mix is than their usual spray, with the advice to test a few
   trees first. Do not quietly remove this.

## UI rules — owner preferences, not negotiable defaults

These come from the owner and from how these apps get used: outdoors, in
sun, on a phone, by users who should not have to work anything out.

- Text must be large and high contrast. Base >= 17px, medium weight, dark
  ink. **No light-grey helper text.** Keep the Aa size toggle in the header.
- **No `<select>` elements.** Use tappable rectangular button groups. Chips
  are rectangular, not pill-shaped.
- **No browser spinner arrows** on number inputs.
- Language switcher shows the **current** language with a 2-character label
  (中文 / EN / BM), so the header title never wraps.
- Label Malay as "Malay" in UI text, "BM" on the compact toggle.
- First launch offers a language choice and persists it. No silent default.
- Land area in **acres** (英亩 / ekar), not hectares. Hectares are offered
  only as an input conversion.
- Every input the calculation depends on sits together at the top, visible,
  before the results. Do not move an input inline into a sentence or hide it
  lower down. Explanatory text may collapse; inputs may not.
- No redundant entries: if a section is a checklist, show only the checklist.
- Navigation uses language-neutral icons. Never Chinese characters as icons
  with a label in another language beneath.
- In Chinese UI text use 软件 for "app", not the Latin word "app".
- App icons carry no text in any language.

## Translations

Three languages, one `I18N` object in `index.html`, keys `zh` / `en` / `ms`.
Every key must exist in all three. If you add a string, add all three — do
not ship English text into the Chinese or Malay UI. Translate agronomic terms
rather than leaving English in Malay text.

## Drone data

`MODELS` holds spray tank capacity in litres only. Spreading hoppers are
excluded — this app doses liquid. Model numbers track payload in kilograms,
not tank litres, so T40 and T50 share a 40 L tank and T20/T20P/T25/T25P all
share 20 L. That is correct, not a bug.

Verified against DJI product pages, September 2026. If you add a model,
verify its tank against DJI's own specs page, not a dealer listing.
