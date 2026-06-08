# Animation Interface Demos

Self-contained TSX + CSS Module interface demos for the Eigent website.

## Structure

Each demo is three files:

```
{Name}Display.tsx       — server-renderable React component
{Name}Cycler.tsx        — "use client" animation island
{Name}Display.module.css — all styles (no Tailwind, no external vars)
```

## How to generate a new demo

Use the `animation-interface-demo` skill:

```
/animation-interface-demo
```

Then describe the workflow or process you want to animate. The skill will generate all three files.

## How to use in your website

Drop all three files into your website's component directory. The `Display` component is server-renderable — just import and render it:

```tsx
import EigentInterfaceDisplay from "./EigentInterfaceDisplay";

export default function Page() {
  return <EigentInterfaceDisplay />;
}
```

The `Cycler` island activates automatically on the client after idle. It pauses when the component is scrolled off-screen or the tab is hidden, and respects `prefers-reduced-motion`.

## Requirements

- React 18+
- `next/image` (or swap with `<img>` for non-Next projects)
- `lucide-react`
