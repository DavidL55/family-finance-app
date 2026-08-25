// src/__tests__/helpers/renderPresence.ts — Stage 7 T7c.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SOURCE PRESENCE IS NOT RENDER PRESENCE, AND THIS MODULE IS THE DIFFERENCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Three guards in this repo say so in their own headers and hand the conversion to T7c:
//
//   · `forecastGlossaryWiring.test.ts` — "This is SOURCE presence, not RENDER presence. It cannot
//     tell an `<Explain>` on a live branch from one behind a condition that is never true."
//   · `adviceBoundary.test.ts` — "it cannot tell a component that renders the notice from one that
//     imports it and puts it behind a collapsed panel."
//   · `AiExtractionEgressNotice.surfaces.test.tsx` — `/<AiExtractionEgressNotice\b/.test(src)`,
//     which `{SHOW_NOTICE ? <Notice/> : null}` satisfies exactly.
//
// All three are the same shape, and the split that landed before this task wrote the general form
// of it down: **a guard keyed on "does the source mention X" goes quiet the moment X stops being
// reached; a guard keyed on "what is in the DOM" goes red.** The predicates below are the second
// kind. They take a rendered container and answer questions about what a reader can actually see.
//
// ── WHY THESE ARE PURE FUNCTIONS OVER A `ParentNode`, IN A HELPER ──────────────────────────────
//
// Same reason `extractionSurfaces.ts` exists: importing one test file from another executes its
// `vi.mock` registrations and every render case inside the importing suite. A helper module
// registers no mocks, renders nothing, and vitest never collects it — so the card suite, the screen
// suite and T7c's own guard can share one implementation of "is there an `<Explain>` here" instead
// of three that drift.
//
// ── THE ONE THING THAT IS A CONVENTION RATHER THAN A FACT, STATED ─────────────────────────────
//
// A rendered `<Explain>` is identified by `data-tour-id="explain.<id>"` (`Explain.tsx:74`). That is
// the ONLY DOM trace it leaves that carries the id — the button's `aria-label` carries the entry's
// TITLE, not its id — and `Explain` returns `null` for an unknown id before that attribute is ever
// written. So "the attribute is in the DOM" means "the entry exists AND the branch rendered", which
// is exactly the conjunction the source-presence guards cannot see. `explainAttributeSelector` is
// asserted against the real component in T7c's suite rather than trusted from this paragraph.

/** The `data-tour-id` prefix a rendered `<Explain>` writes. See the header for why this is the seam. */
export const EXPLAIN_TOUR_PREFIX = 'explain.';

/** The attribute selector that finds every rendered `<Explain>`, whatever its id. */
export const EXPLAIN_SELECTOR = `[data-tour-id^="${EXPLAIN_TOUR_PREFIX}"]`;

/** The currency sign every money figure in this app is rendered with (`formatILS`). */
export const ILS_SIGN = '₪';

/** Tailwind's lining-figures utility. §7: "`tabular-nums` on every numeric cell". */
export const TABULAR_NUMS_CLASS = 'tabular-nums';

/**
 * The glossary ids of every `<Explain>` that is ACTUALLY IN THE DOM, in document order.
 *
 * Not `Set`, because a duplicate is meaningful: the same id rendered beside two different figures is
 * the screen's own pattern (`forecast.estimatedTotal` sits on three), and a caller that wants
 * uniqueness can ask for it.
 */
export function renderedExplainIds(root: ParentNode): string[] {
  return [...root.querySelectorAll(EXPLAIN_SELECTOR)]
    .map((element) => element.getAttribute('data-tour-id') ?? '')
    .filter((tourId) => tourId.startsWith(EXPLAIN_TOUR_PREFIX))
    .map((tourId) => tourId.slice(EXPLAIN_TOUR_PREFIX.length));
}

/**
 * An element's OWN text — its direct child text nodes, and nothing a descendant contributes.
 *
 * !! THIS IS THE WHOLE REASON THE FIGURE SET CAN BE DERIVED AT ALL. `textContent` on any ancestor of
 * a money figure contains that figure, so a rule written on `textContent` reports the `<body>` as a
 * money figure and every wrapper between. Direct text finds the ONE element that renders the digits,
 * which is the element a reader sees and the element an author adds.
 */
export function directTextOf(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text;
}

/** Whether an `<Explain>` is rendered anywhere inside this element, itself included. */
export function hasExplainWithin(element: Element): boolean {
  return element.matches(EXPLAIN_SELECTOR) || element.querySelector(EXPLAIN_SELECTOR) !== null;
}

/**
 * Every element that RENDERS a money figure — the innermost holder of a `₪`, derived from the DOM.
 *
 * A `data-testid` list would be the enumeration class this stage has counted repeatedly: it passes
 * forever on the figure added tomorrow, which is the exact failure §12 names for this guard.
 */
export function moneyFigureElements(root: ParentNode): Element[] {
  return [...root.querySelectorAll('*')].filter((element) => directTextOf(element).includes(ILS_SIGN));
}

/** A readable identity for a failure message: the testid if there is one, else the tag and its text. */
export function describeElement(element: Element): string {
  const testId = element.getAttribute('data-testid');
  const text = directTextOf(element).trim().replace(/\s+/g, ' ').slice(0, 60);
  return testId === null ? `<${element.tagName.toLowerCase()}> "${text}"` : `${testId} "${text}"`;
}

/**
 * Whether a figure is covered by an `<Explain>`: one inside its own subtree, or one rendered EARLIER
 * AMONG ITS SIBLINGS.
 *
 * ── WHY THE SIBLING CLAUSE, AND WHY IT IS BOUNDED TO *EARLIER* ────────────────────────────────
 *
 * The screen has two shapes and both are deliberate. Most figures carry their own hover inline
 * (`{formatILS(x)}<Explain id="…" />`). The GLANCE figure does not, and must not: D38 puts the
 * label and its ⓘ in a heading row and the figure alone on the line beneath, at `text-3xl`, because
 * an info button inside a 36-pixel number is a tap target sitting in the middle of the one thing
 * the card exists to show. Requiring an `<Explain>` inside that `<p>` would be a guard crying wolf
 * on the plan's own drawing — and a guard that cries wolf is one the next person deletes.
 *
 * EARLIER, not anywhere in the parent, because "the label precedes the figures it governs" is a
 * real property of reading order and "somebody in this section has a hover" is not. Under the looser
 * form a bare `<span>{formatILS(x)}</span>` dropped into the month row — the exact addition §12
 * names — would be covered by the five hovers already in that row, and the guard would pass on the
 * defect it exists to catch. Held by a synthetic case in T7c's suite, both ways round.
 *
 * !! AND THE COVERING SIBLING MUST BE A **LABEL**, NOT ANOTHER FIGURE — WHICH THE MUTATION SWEEP
 * HAD TO TEACH THIS FUNCTION. The first draft accepted any earlier sibling carrying a hover, and
 * deleting `<Explain id="forecast.estimatedTotal" />` from the month row's estimated figure SURVIVED
 * all 2,708 tests: the certain figure sits earlier in the same flex row, carries its own hover, and
 * covered its neighbour. That is the "somebody in this row has a hover" leniency the paragraph above
 * rejects, one level down — a figure cannot vouch for the figure beside it, because the hover it
 * carries explains ITSELF. A label can, and a label is the thing with no ₪ of its own.
 *
 * !! T7c REVIEW F1 — AND "A FIGURE" IS ASKED **SUBTREE-DEEP**, BECAUSE THE FIRST FIX WAS
 * DEPTH-ASYMMETRIC AND THE SURVIVOR CAME STRAIGHT BACK ONE WRAPPER DOWN. The clause above searched
 * the sibling's whole SUBTREE for a hover (`hasExplainWithin`) while asking "is this sibling a
 * figure?" with `directTextOf` — DIRECT TEXT ONLY. So the same certain figure wrapped in one
 * `<div>` stopped counting as a figure and went back to vouching for the figure beside it: M5,
 * reproduced at zero cost to whoever wrapped a row. The shipped tree was already leaning on it —
 * the assumption-override sentence carries a ₪ in its own text with no `<Explain>` and was covered
 * by the flex row above it, which renders the amount in a child `<span>`.
 *
 * The two questions are now asked AT THE SAME DEPTH: `textContent` for the money, `hasExplainWithin`
 * for the hover. A wrapped LABEL — nothing with a `₪` anywhere beneath it — still covers, which is
 * what keeps this a rule about what a hover EXPLAINS rather than a ban on wrapper elements.
 */
export function isExplainCovered(element: Element): boolean {
  if (hasExplainWithin(element)) return true;
  const parent = element.parentElement;
  if (parent === null) return false;
  for (const sibling of parent.children) {
    if (sibling === element) return false; // reached the figure: nothing earlier carried a hover
    // A sibling that renders money — ITS OWN OR ANY DESCENDANT'S — is a FIGURE, and the hover it
    // carries explains that figure. Only a LABEL, with no ₪ anywhere beneath it, can cover the one
    // below it. `textContent`, not `directTextOf`: see the F1 paragraph above.
    if ((sibling.textContent ?? '').includes(ILS_SIGN)) continue;
    if (hasExplainWithin(sibling)) return true;
  }
  return false;
}

/** Money figures with no `<Explain>` of their own and none earlier beside them. */
export function unexplainedMoneyFigures(root: ParentNode): Element[] {
  return moneyFigureElements(root).filter((element) => !isExplainCovered(element));
}

/**
 * Whether a figure's digits are set in lining figures — `tabular-nums` on the element itself or on
 * an ancestor, because the utility inherits.
 */
export function hasTabularNums(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains(TABULAR_NUMS_CLASS)) return true;
  }
  return false;
}

/** Money figures rendered in proportional figures — §7's "`tabular-nums` on every numeric cell". */
export function misalignedMoneyFigures(root: ParentNode): Element[] {
  return moneyFigureElements(root).filter((element) => !hasTabularNums(element));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T7c REVIEW — THE ₪0 RIGOUR ASYMMETRY, AND WHY THE RIGOROUS HALF MOVED HERE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `statisticalLayerCorpus.test.ts` parses figures and asks whether one of them is ZERO — it handles
// `₪0`, `₪ 0`, `₪0,00` and a figure at the end of a sentence, and it deliberately does NOT fire on
// `₪0.50`. The two DOM-level checks over the same ruling were `not.toContain('₪0.00')`: one literal
// spelling out of four, over the surfaces where the ruling is actually READ. A `₪0` from a
// formatter change, a hand-rolled figure or a locale would have walked straight past both.
//
// MOVED, byte-identical body and comments, not copied — the F4 class this helper family exists for.
// The corpus suite imports it from here; the card and screen suites point it at rendered DOM.

/**
 * Whether a string contains a ₪ figure whose VALUE is zero, in any spelling.
 *
 * Written as "find every money figure, then ask whether one of them is zero" rather than as one
 * clever regex, because the clever regex was wrong on its first draft in exactly the direction that
 * matters: `/₪\s*0(?:[.,]0+)?(?!\d)/` matched the leading `₪0` of `₪0.50` and would have failed a
 * guard on a real, non-zero figure. An over-approximating guard that fires on innocent output is a
 * guard people delete — the same correction the loop-termination guard's structural half had to
 * make.
 */
export function containsZeroMoney(text: string): boolean {
  // `: string[]` IS LOAD-BEARING, and the T6 review's F1 is why. `String.match` returns
  // `RegExpMatchArray | null`; `?? []` makes the type a UNION with the empty array literal, and
  // calling `.some` on a union of array types hands the callback the INTERSECTION of the element
  // types — `string & never` — so `figure.replace` does not exist. It compiled only because a built
  // `dist/` was joining the program under `allowJs` and suppressing the error; `tsconfig.json` now
  // excludes the build output (`typeCheckScope.test.ts`), so the annotation has to be here. It
  // states the type this line already depends on; it is not a cast.
  const figures: string[] = text.match(/₪\s*\d+(?:[.,]\d+)?/g) ?? [];
  return figures.some((figure) => Number(figure.replace(/[₪\s]/g, '').replace(',', '.')) === 0);
}

/**
 * Every element that RENDERS a ₪0 — "₪0 never means unknown", asked of the DOM rather than of one
 * spelling.
 *
 * Built on `moneyFigureElements`, so it names the innermost element a reader sees rather than every
 * wrapper above it, exactly as the hover and `tabular-nums` rules do.
 */
export function zeroMoneyFigures(root: ParentNode): Element[] {
  return moneyFigureElements(root).filter((element) => containsZeroMoney(directTextOf(element)));
}
