# The front door: landing, the name field, Save

What a first visit sees before it starts, how the font's name says it can be edited, and how
keeping a font reads beside the room of kept fonts. From the November audit's P2 list. The
design rounds live on the project's Design canvas (round 3, on its Review page); the link is
kept in the brand's notes, not in this public repo.

## Decided

- No landing page: the workbench itself is the front door (round 5 set aside, 23 November).
  What the tool is, the questions and who made it live on `/about`, from the footer.
- Save and its room must not share a word, and the Save button either keeps one label and
  sets `aria-pressed`, or swaps its label without it, never both (WAI-ARIA APG, button
  pattern).
- Save and My fonts: Save font keeps its Save font / Saved label and drops `aria-pressed`;
  the door is a button, "My fonts" and the count, beside it (round 5's A, picked 24 November).
  The room is headed My fonts. No avatar: there are no accounts.
- About: its own prerendered page at `/about` (round 8's D: a contents list, one h1, an h2
  per section, an h3 per question with the answer showing), in the sitemap and linked from
  the footer as "About and questions".
- Name field: B, a pencil inside the dashed box (picked 23 November). The box is a label
  around the input, so pressing the pencil puts the caret in; the pencil is muted at rest
  and ink on hover and focus, and the box goes solid red while editing.

## Open

- The look: Darkroom is picked in light and dark, but the site keeps today's colours until
  Hendri says go, since the brand files change with the new accent.

## References

- Figma: eyebrow, headline, one line, one button. Descript and Framer: the product is the
  hero image. Canva: a feature list with a working demo beside it. Retool: one line, one free
  button, no tour. Nobody puts a field you can type into on the front page before the tool.
- Dovetail and Plane: a document title that reads as text and shows it can be edited on
  hover. Chronicle: a bordered box only while it is being edited.
- Magnific: Save to collection, with "Go to all collections" in the same popover. Shop,
  Babbel, Urban Outfitters: the toggle is an icon on the item, the list a noun in the nav.
  Wikipedia: Save, then "Remove from" the list. Nobody uses the same word for the toggle and
  the list's door.
- WAI-ARIA Authoring Practices, button pattern, and MDN on `aria-pressed`: a toggle's label
  does not change with its state.

## Deferred

- Nothing yet.
