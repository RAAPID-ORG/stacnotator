# UI conventions

The rules that make screens read as one product. Reach for the shared piece
before styling a control by hand; if none fits, add one to `frontend/src/shared/ui`
rather than restyling in place.

The root font size is 18px (`html` in `styles/app.css`), so rem-based sizes run
larger than Tailwind's defaults: `text-sm` is about 16px, `h-8` is 36px.

## Type

| Role            | Style                                                               | Where                          |
| --------------- | ------------------------------------------------------------------- | ------------------------------ |
| Page title      | `.page-title`                                                       | the heading of a page          |
| Page subtitle   | `.page-subtitle`                                                    | the line under it              |
| Section heading | `.section-heading`, `.section-description`                          | a section inside a surface     |
| Chrome text     | `text-[13px]` regular                                               | sidebar, breadcrumbs, top bars |
| Body and forms  | `text-sm` / the `Input` and `Button` primitives                     | page content                   |
| Panel heading   | `text-[11px] font-medium uppercase tracking-wider text-neutral-500` | panel and dropdown headings    |
| Caption         | `text-[11px]` or `text-[10px] text-neutral-500`                     | hints under a control          |

## Icons

- One family: the outline icons in `shared/ui/Icons.tsx` (20-unit grid, 1.5
  stroke). No second style for the same idea, no emoji in chrome.
- A `Filled` variant exists only to mark a state, such as a slice that has a
  comment. It is never a heavier look for a button.
- Size: `h-4 w-4` beside chrome or body text and in icon-only buttons;
  `h-3.5 w-3.5` for chevrons and inside `text-xs` controls; `h-3 w-3` inside
  chips and badges.
- Muted by default (`text-neutral-500`); the icon takes the label's colour when
  the control is active.

## Controls

| Need                               | Use                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A page action                      | `Button` (`primary` for the one main action, `secondary` beside it)                                                                |
| A control in a top bar             | `BarButton`: h-8, 13px, 16px icon; `menu` adds a chevron, `active` marks pressed or open, `collapse` drops the label below desktop |
| A choice between a few peers       | `SegmentedControl` (`size="bar"` in a top bar)                                                                                     |
| A small icon action inside content | `IconButton`                                                                                                                       |

A bar's controls sit `gap-1` apart, with a `h-5 w-px bg-neutral-200` rule
between groups. Dropdowns opened from a page header or bar sit at `z-30`, above
the page's sticky bars (`z-20`).
