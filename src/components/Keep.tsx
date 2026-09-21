/**
 * Keeping a font.
 *
 * It sits in the masthead beside the count of what is already kept, as a
 * button of its own. It spent one round on the name's line, on the argument
 * that keeping is a property of the thing you have named — and beside the
 * name it read as a second field rather than as a verb. Next to the shelf it
 * puts things on, it says what it does before you press it.
 *
 * It was a bare heart before that. An unlabelled icon asks the reader to
 * guess, and a heart guesses back — it says *liked*, which is a thing you do
 * to somebody else's work, where this is keeping your own. So the words are
 * there and the button is the same one Compose is.
 *
 * A bookmark rather than a heart or a disk: it is the mark every tool that
 * keeps things for later uses, it means "put this where I can find it again",
 * and it survives being drawn at fourteen pixels. Filled means kept, and the
 * label says Saved, which is also the press that forgets.
 */
export function Keep({ kept, onToggle }: { kept: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={kept ? 'keep is-kept' : 'keep'}
      aria-pressed={kept}
      title={kept ? 'Kept — press to forget this font' : 'Keep this font'}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d="M6 3.6h12v17.2l-6-4.6-6 4.6Z"
          fill={kept ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {kept ? 'Saved' : 'Save font'}
    </button>
  )
}
