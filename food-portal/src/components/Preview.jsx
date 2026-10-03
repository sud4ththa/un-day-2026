import { bankPreviewLines } from '../lib/bankDetails.js'
import { allergenList, dietLabel, spiceLabel, tasteLabel } from '../lib/format.js'

function moneyBlock(stall) {
  if (stall.support_type === 'food') return null
  const lines = []
  if (stall.amount_per_family.trim()) lines.push(`Amount per family: ${stall.amount_per_family.trim()}.`)
  if (stall.how_to_pay.trim()) lines.push(stall.how_to_pay.trim())
  if (stall.payment_deadline.trim()) lines.push(`Please pay by ${stall.payment_deadline.trim()}.`)
  return lines
}

export function Preview({ stall, dishes, allowBankDetails = false }) {
  const showFood = stall.support_type === 'food' || stall.support_type === 'both'
  const showMoney = stall.support_type === 'money' || stall.support_type === 'both'
  const named = dishes.filter((dish) => dish.name.trim())
  const pay = showMoney ? moneyBlock(stall) : null
  const bank = showMoney ? bankPreviewLines(stall, allowBankDetails) : []
  const contact = [stall.food_coordinator_name.trim(), stall.food_coordinator_phone.trim()]
    .filter(Boolean)
    .join(', ')

  return (
    <article className="letter" aria-label="Parent form preview">
      <p className="letter-kicker">UN Day · Friday 16 October 2026</p>
      <h3>{stall.name}</h3>
      <p>Dear parents,</p>
      <p>
        The PTC is collecting contributions for the {stall.name} stall
        {stall.year_groups.trim() ? ` (${stall.year_groups.trim()})` : ''}.
      </p>
      {stall.support_type === 'both' && stall.contribution_mode === 'either' ? (
        <p>Each family can either send food or make the payment below.</p>
      ) : null}
      {stall.support_type === 'both' && stall.contribution_mode === 'both' ? (
        <p>Each family is asked to send food and to make the payment below.</p>
      ) : null}
      {pay ? (
        <div>
          <h4>Payment</h4>
          {pay.length ? pay.map((line) => <p key={line}>{line}</p>) : <p className="muted">Payment details are not filled in yet.</p>}
          {bank.length ? (
            <>
              <h4>Bank details</h4>
              {bank.map((line) => <p key={line}>{line}</p>)}
            </>
          ) : null}
        </div>
      ) : null}
      {showFood ? (
        <div>
          <h4>Food list</h4>
          <p>
            Please support the {stall.name} stall. Food should be sample sized. About 20 pieces
            is a helpful amount, and more is welcome.
          </p>
          {contact ? <p>Questions about food for this stall? Contact {contact}.</p> : (
            <p className="muted">A food coordinator is not listed yet.</p>
          )}
          {stall.halal_note.trim() ? <p>{stall.halal_note.trim()}</p> : null}
          {stall.packaging_note.trim() ? <p>{stall.packaging_note.trim()}</p> : null}
          {stall.dropoff_instructions.trim() ? <p>{stall.dropoff_instructions.trim()}</p> : null}
          {named.length === 0 ? (
            <p className="muted">No dishes yet.</p>
          ) : (
            <ul className="menu">
              {named.map((dish) => {
                const bits = [
                  dietLabel(dish.diet),
                  tasteLabel(dish.taste),
                  spiceLabel(dish.spice),
                ].filter(Boolean)
                const allergens = allergenList(dish)
                return (
                  <li key={dish.id}>
                    <strong>{dish.name}</strong>
                    {bits.length ? <span className="menu-meta">{bits.join(' · ')}</span> : null}
                    <span className="menu-meta">
                      {dish.made_by === 'caterer'
                        ? `Caterer: ${[dish.caterer_name, dish.caterer_contact].filter(Boolean).join(', ') || 'name not set'}`
                        : 'Home or a parent'}
                      {dish.target_pieces !== '' && dish.target_pieces != null
                        ? ` · Target ${dish.target_pieces} pieces`
                        : ''}
                    </span>
                    <span className="menu-meta">
                      {allergens.length ? `Allergens: ${allergens.join(', ')}` : 'Allergens not filled in'}
                    </span>
                    {dish.notes.trim() ? <span className="menu-note">{dish.notes.trim()}</span> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
      <p>Thank you. UN Day could not take place without parents.</p>
      <p className="signoff">
        the PTC
        <br />
        The British School in Colombo
      </p>
    </article>
  )
}
