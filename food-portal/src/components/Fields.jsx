export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  )
}

export function Choice({ name, legend, value, options, onChange, columns, disabled }) {
  return (
    <fieldset className="choice" disabled={disabled}>
      <legend className="label">{legend}</legend>
      <div className={`seg${columns ? ` seg-${columns}` : ''}`}>
        {options.map(([id, text]) => (
          <label key={id} className={value === id ? 'seg-btn on' : 'seg-btn'}>
            <input
              type="radio"
              name={name}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
            />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
