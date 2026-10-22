# TabGen UI prototype

High-fidelity, clickable prototype for the **complete** TabGen app (all phases), not only Phase 1.

Stack: React 19 + Vite + TypeScript + Tailwind CSS v4 + Radix/shadcn-style primitives. Turkish is the default UI language; English is a toggle. Mock data only — no backend.

```bash
cd design
npm install
npm run dev      # http://localhost:5180
```

Reusable pieces for the real `apps/web` frontend:

- `src/components/ui/` — shadcn-compatible primitives (copy as-is)
- `src/components/app/` — ChordDiagram, ChordGrid, SectionStrip, Transport, TabStaff
- `src/lib/music.ts` — transpose / capo / simplify / shapes (same contract as `packages/music-core`)
- `src/i18n/tr.ts` + `en.ts` — every string
- `src/styles/index.css` — design tokens (including section colors, confidence, hit/miss)

Query flags for review:

| Flag | Effect |
|---|---|
| `?lang=en` | English |
| `?theme=light` | Light theme |
| `?empty=1` | Empty library |
| `/processing/:id?pause=1` | Frozen progress (no auto-advance) |
