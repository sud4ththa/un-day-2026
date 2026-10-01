export function Header({ title, subtitle, onSignOut, onBack, children }) {
  return (
    <header className="top">
      <p className="kicker">The British School in Colombo · Parent Collective · UN Day 2026</p>
      {onBack ? (
        <button type="button" className="back" onClick={onBack}>
          All stalls
        </button>
      ) : null}
      <div className="top-row">
        <h1>{title}</h1>
        {onSignOut ? (
          <button type="button" className="btn btn-quiet" onClick={onSignOut}>
            Sign out
          </button>
        ) : null}
      </div>
      {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      {children}
    </header>
  )
}
