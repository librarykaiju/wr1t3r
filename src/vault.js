// What the editor can know about the rest of the vault, given by the app:
// vaultHost holds { paths(), text(path), fetch(url) } for notes on this
// device, and notePath the open note's path.

import { Facet, StateEffect } from "@codemirror/state";

export const vaultHost = Facet.define({ combine: (v) => v[0] || null });
export const notePath = Facet.define({ combine: (v) => v[0] || null });

// Dispatched by the app when notes arrive, change or go, so views that depend
// on other notes (backlinks, unresolved links) redraw.
export const vaultChanged = StateEffect.define();
