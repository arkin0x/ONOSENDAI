# 02 — What must a spatial client make perceivable?

Type: research
Status: claimed
Blocked by: —

## Question

Before choosing how the space looks, establish what it must *communicate*. The
protocol has a small number of properties that are genuinely counterintuitive,
and the spec is explicit that one of them is central: movement cost is set by
*which power-of-two boundary you cross*, not by how far you travel.

Derive, from `/data/repos/cyberspace/CYBERSPACE_V2.md` (and `decks/`), the
inventory of things a spatial client must let a person perceive, and rank them by
how badly they fail to be intuitive without visualization.

Cover at least:

- **Place** — where you are in an 85-bit axis space, and what makes one location
  distinguishable from another (§2, §3: identity *is* location).
- **Direction and destination** — which way is which, and where you are headed.
  Note §11.1–11.3: the canonical view and the black sun at `+Z_cs`, which this
  app implements as an orientation but renders no marker for.
- **Cost and reachability** — LCA height (§4.4), why a 1-gibson step can cost
  16×, decomposition invariance (§4.8: there are no shortcuts), the hop/sidestep
  split (§6.13–6.14: continents you cannot cross at all).
- **Terrain** — K as the temporal cost landscape (§5.2), constant across 2^3
  blocks, hills and valleys.
- **Scale** — the height hierarchy and its physical meanings (§7.3, §9.2).
- **Regions** — aligned subtrees, why two people in one region agree without
  communicating (§4.5), and discovery radius (§7.3).
- **Planes** — dataspace and ideaspace sharing XYZ (§2.4).

For each: state what it is, why it is unintuitive, what a person must be able to
*see* to grasp it, and whether v2 currently shows it at all.

Then answer the framing question: **which two or three of these, if made
perceivable, would do the most to make Cyberspace feel like a place?**

Deliverable: the ranked inventory in the ticket's Answer, with spec section
references. This is the brief that tickets 03–05 design against.
