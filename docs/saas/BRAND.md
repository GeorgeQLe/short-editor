# SiftCut Brand System

## Names and descriptions

- **SiftCut** is the master brand. Capitalize it exactly as shown.
- **SiftCut Desktop** is the free, MIT-licensed, local/offline-first editor.
- **SiftCut Cloud** is the paid managed workspace for creator teams.
- **SiftCut Mobile** is the paid Cloud companion for capture, review, and
  managed workflows—not a full mobile edit bay.

Use **“Long-form context. Short-form clarity.”** as the brand line and
**“Find the short hiding inside the long story.”** as the landing headline.
Describe the product as **“AI-assisted, human-approved.”**

SiftCut is provider-neutral. Do not present it as “powered by OpenAI,” an
OpenAI reseller, an API wrapper, or a generic AI wrapper. Provider and
subprocessor names belong in technical, trust, and privacy material when
relevant, not in headline marketing copy.

## Visual system

The existing master at
`resources/branding/siftcut-app-icon-master.svg` is authoritative; formalize
derivatives from it rather than redesigning the mark. Use Inter typography,
dark editorial surfaces, mint for primary actions, violet for product accent,
and amber for status or caution. Preserve visible focus, strong contrast, and
reduced-motion behavior.

Web derivatives are generated deterministically by `scripts/render-app-icon.mjs`:

- `favicon-32.png` — 32×32 browser favicon;
- `app-web-icon-512.png` — 512×512 install/share icon;
- `social-card-1200x630.png` — 1200×630 dark editorial social card derived
  from the same master icon and approved copy.
