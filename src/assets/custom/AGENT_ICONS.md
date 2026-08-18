# Eigent agent icon system

This folder contains the standalone SVG source for Eigent's agent icon family. The selected core direction is geometric and has no eyes, pupils, faces, or capability badges.

## Core icons

| Agent    | File                 | Structural parts                    |
| -------- | -------------------- | ----------------------------------- |
| Default  | `eigen-default.svg`  | Eigent lambda                       |
| Code     | `eigen-code.svg`     | Code brackets, inner lambda         |
| Document | `eigen-document.svg` | Page, fold, inner lambda            |
| Image    | `eigen-image.svg`    | Frame, landscape, caret highlight   |
| Bird     | `eigen-bird.svg`     | Mirrored wings, head/body/tail      |
| Browser  | `eigen-browser.svg`  | Globe, split equator, Eigent lambda |

Each file is a complete `24 × 24` SVG. Elements carry a `data-part` name so the geometry remains understandable and editable without changing how the SVG renders.

`eigen-operators-samples.svg` is the visual inspection sheet for the six core icons and the ten general-purpose caret patterns.

## Construction rules

1. Use `viewBox="0 0 24 24"` and keep the important geometry inside the `2–22` area.
2. Use `fill="none"`, `stroke="currentColor"`, `stroke-linecap="round"`, and `stroke-linejoin="round"` on the root SVG.
3. Use a stroke hierarchy instead of forcing every element to the same weight:
   - `2px` for the primary silhouette or container.
   - `1.65px` for Eigent/lambda geometry and other important internal forms.
   - `1.25px` for folds, equators, highlights, and supporting detail.
4. Keep the icon recognizable at `16px`. Remove a secondary line before shrinking the entire composition or reducing the primary stroke below `2px`.
5. Avoid path collisions. Break a supporting line into segments when it crosses the Eigent mark; the Browser icon's split equator is the reference.
6. Do not add eyes, facial details, text, gradients, shadows, or a background shape to the core six.

## Eigent lambda grammar

The default mark is the reference:

```svg
<path data-part="lambda" d="M7 17 12 7M11 5l6 12"/>
```

- The form is narrow and centered.
- The right-hand stroke extends only a little beyond the top intersection.
- There is no bottom foot.
- Derived icons should reuse a caret or lambda gesture rather than paste the entire logo into every container.

## Standalone SVG template

```svg
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path data-part="structure" d="..."/>
  <path data-part="lambda" d="..." stroke-width="1.65"/>
  <path data-part="detail" d="..." stroke-width="1.25"/>
</svg>
```

Prefer separate elements for separate concepts. Do not flatten the complete icon into one opaque path unless the geometry truly forms one continuous stroke.

## Color switching

Every icon uses `currentColor`. An inline SVG therefore follows the surrounding CSS color:

```css
.agent-icon {
  color: var(--agent-color);
}
```

Keep color outside the SVG source. Do not hard-code agent colors into individual files. Note that an SVG loaded through a plain `<img>` does not inherit the parent element's `color`; inline it or render the same nodes as a React icon when color inheritance is required.

## React/Lucide implementation

Use `createLucideIcon` when the icon must behave like a Lucide component:

```tsx
import { createLucideIcon } from 'lucide-react';

export const ExampleAgentIcon = createLucideIcon('example-agent', [
  ['path', { d: '...', key: 'structure' }],
  ['path', { d: '...', strokeWidth: '1.65', key: 'lambda' }],
  ['path', { d: '...', strokeWidth: '1.25', key: 'detail' }],
]);
```

Give every node a stable key. Preserve intentional per-node stroke widths when translating the SVG into React.

## Building a new family member

1. Start with the job's familiar Lucide silhouette.
2. Identify one place where a caret, lambda, mirror, rotation, split, or repetition can carry the Eigent signature.
3. Draw the primary silhouette first at `2px`.
4. Add the brand geometry at `1.65px` and supporting detail at `1.25px` only where needed.
5. Check the result at `16px`, `20px`, and `24px`, in light and dark themes.
6. Add the standalone file to this folder and its symbol to `eigen-operators-samples.svg`.
7. Validate the SVG and the application mapping before replacing an existing icon.

## Validation

```sh
xmllint --noout src/assets/custom/eigen-*.svg
npm run type-check
```

Also inspect the rendered contact sheet. XML validity does not reveal visual collisions, uneven padding, or a weak silhouette.
