/**
 * Multi-position toggle, styled after the little slide switches on a pedal.
 * The puck slides to the selected position; clicking any legend selects it.
 */
export function Switch({ def, value, onChange }) {
  const index = Math.max(0, def.options.findIndex((o) => o.value === value))
  const count = def.options.length

  return (
    <div className="switch-wrap">
      <span className="switch-label">{def.label}</span>
      <div
        className="switch-track"
        role="radiogroup"
        aria-label={def.label}
        style={{ '--switch-count': count }}
      >
        <span
          className="switch-puck"
          aria-hidden="true"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {def.options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={opt.value === value}
            className={`switch-option ${opt.value === value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
