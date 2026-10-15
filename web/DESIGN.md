# Alpha Desk design guide

Alpha Desk is used by shop owners and service writers, often on a phone, often
with dirty hands, sometimes in direct sun. The interface should feel like a well
kept shop manual: plain words, big targets, one obvious next action.

## The look

- **Concrete and paper.** The page you read and write on is paper (`bg-bg-base`).
  The frame around it (side rail, top bar, tab bar) is concrete (`bg-bg-chrome`).
  Raised things (sheets, cards, inputs) are `bg-bg-card`.
- **Graphite text.** `text-text-primary`, `text-text-secondary`, `text-text-muted`.
  Muted is for timestamps and hints, never for anything required to act.
- **Dashboard lamps.** Status is a lamp plus a word, never colour alone.
  Green = good or done. Amber = needs a look. Red = needs you now. Blue lamp = in progress.
  Grey lamp = not started. Use `<span className="lamp lamp-green" aria-hidden />` next to the label.
- **Blue means tappable.** `text-blue`, `btn-primary`, links, selected tab, focus ring.
  Do not use blue as decoration.
- **Fonts.** Overpass (a road-sign face) for page titles, section titles and
  numbers: class `display`, and `num` for tabular figures. Atkinson Hyperlegible
  Next for everything else. Atkinson's slashed zero is intentional: it keeps 0 and O
  apart in part numbers and plates.
- **One memorable thing.** The repair-order hang tag (`.rotag`) and the lamps.
  Everything else stays quiet: hairlines, no shadows, no gradients.

## Tokens

All colours are CSS variables defined in `src/app/globals.css` and exposed to Tailwind
in `tailwind.config.js`. They flip automatically for dark mode, so **never hardcode a
colour**.

| Use | Tailwind class |
| --- | --- |
| Page | `bg-bg-base` |
| Rail, top bar, tab bar | `bg-bg-chrome` |
| Card, sheet | `bg-bg-card` |
| Hover | `bg-bg-hover` |
| Input | `bg-bg-input` |
| Hairline | `border-border` |
| Control border (3:1) | `border-line` |
| Text | `text-text-primary` / `text-text-secondary` / `text-text-muted` |
| Interactive | `text-blue`, `bg-blue/10`, `border-blue` |
| Status text | `text-green`, `text-amber`, `text-red` |
| Soft status fill | `bg-green/[0.14]`, `bg-red/[0.12]` |
| Translucent overlay on any surface | `bg-text-primary/5` (never `bg-white/5`) |

Banned in app code: `text-white`/`bg-white` (except white text on a solid red lamp
badge), `text-gray-*`, `bg-gray-*`, `bg-[#...]`, `text-[#...]`, gradients, `shadow-black/*`,
`backdrop-blur`, `uppercase`, `tracking-wider`, emoji used as icons.

## Components (classes in globals.css)

- Layout: `page-container`, `page-header`, `page-title`, `page-subtitle`, `section-title`, `toolbar`
- Surfaces: `card`, `panel`, `panel-header`, `panel-body`, `empty-state`
- Buttons: `btn` + `btn-primary | btn-secondary | btn-ghost | btn-danger | btn-success`, sizes `btn-sm`, `btn-lg`, `btn-icon`
- Forms: `form-input`, `form-select`, `form-textarea`, `form-label`, `form-hint`, `form-error`
- Pills: `tag` + `tag-blue | tag-green | tag-red | tag-amber | tag-gray`
- Lists: `ledger` (the `ul`) with `ledger-row`, `ledger-main`, `ledger-title`, `ledger-sub`, `ledger-amt`
- Hang tag: `rotag lamp-green | lamp-amber | lamp-red | lamp-blue`
- Tables: `data-table` (wrap in `overflow-x-auto`; on a phone prefer a ledger list instead)
- Dialogs: `Sheet` component (`src/components/Sheet.tsx`) or the legacy `modal-overlay` + `modal-box`
  (both become bottom sheets on phones automatically)
- Loading: `skeleton`. Icons: `Icon` from `@/components/Icon` (add new ones there).

## Rules of the house

1. **Phone first.** Design at 390px wide, then widen. No horizontal page scroll.
   Tap targets are at least 44px tall. Inputs are 16px so phones do not zoom.
2. **Sentence case everywhere.** "Customers owe you", not "CUSTOMERS OWE YOU".
   No tracked-out ALL-CAPS eyebrows above headings.
3. **Say it plainly.** Buttons name the action ("Send estimate", "Record payment").
   The same action keeps the same name through the whole flow.
4. **Every list has four states:** loading (skeleton), error (what failed + "Try again"),
   empty (what this is + the one action to fill it), and populated. An error must never
   look like "you have none".
5. **Errors say what happened and what to do.** They do not apologise.
6. **Numbers are tabular** (`num`) and money always shows a currency sign. Right align money.
7. **Colour is never the only signal.** Lamps always sit beside a word.
8. **Motion answers a touch.** Sheets slide up, nothing animates on its own. Respect
   `prefers-reduced-motion` (handled globally).
9. **No emoji as icons.** Use `Icon`. Sentiment (happy/neutral/unhappy) uses `smile`, `meh`, `frown`.
10. **Never put another shop's name, address or phone in the UI.** Read it from settings.
11. **Do not change business logic** (money maths, payments, signatures, numbering, RLS
    scoping with `shop_id`) while restyling.

## Testing locally

A fake backend and screenshot tools live in the session scratchpad; see the
task prompt. Check every screen at 390x844 and 1280x800, light and dark, and with
loading, error, empty and populated data.
