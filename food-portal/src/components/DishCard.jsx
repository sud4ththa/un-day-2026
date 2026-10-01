import { useState } from 'react'
import { allergenList, dietLabel, tasteLabel } from '../lib/format.js'
import { ALLERGENS, DIET_OPTIONS, MADE_OPTIONS, SPICE_OPTIONS, TASTE_OPTIONS } from '../lib/plan.js'
import { Choice, Field } from './Fields.jsx'

export function DishCard({
  dish,
  index,
  total,
  open,
  matches,
  readOnly,
  onToggle,
  onChange,
  onMove,
  onRemove,
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const summary = [dietLabel(dish.diet), tasteLabel(dish.taste)].filter(Boolean).join(' · ')
  const allergens = allergenList(dish)

  function patch(partial) {
    onChange(dish.id, partial)
  }

  function toggleAllergen(key) {
    const has = dish.allergens.includes(key)
    patch({
      allergens: has ? dish.allergens.filter((item) => item !== key) : [...dish.allergens, key],
    })
  }

  return (
    <article className={`dish${open ? ' open' : ''}`} id={`dish-${dish.id}`}>
      <div className="dish-bar">
        <div className="dish-move">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onMove(dish.id, -1)}
            disabled={readOnly || index === 0}
            aria-label={`Move ${dish.name || 'dish'} up`}
          >
            Up
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onMove(dish.id, 1)}
            disabled={readOnly || index === total - 1}
            aria-label={`Move ${dish.name || 'dish'} down`}
          >
            Down
          </button>
        </div>
        <button type="button" className="dish-title" onClick={onToggle} aria-expanded={open}>
          <span>{dish.name.trim() || 'Untitled dish'}</span>
          <span className="dish-summary">
            {summary || 'Diet and taste not set'}
            {allergens.length ? ` · ${allergens.join(', ')}` : ''}
          </span>
        </button>
      </div>

      {matches.length ? (
        <ul className="warn-list">
          {matches.slice(0, 3).map((match) => (
            <li key={`${match.stall_id}-${match.dish_name}`}>
              {match.kind === 'same' ? 'Same dish' : 'Similar dish'} on {match.stall_name}
              {match.kind === 'similar' ? `: ${match.dish_name}` : ''}
            </li>
          ))}
          {matches.length > 3 ? <li>And {matches.length - 3} more.</li> : null}
        </ul>
      ) : null}

      {open ? (
        <div className="dish-body">
          <Field label="Dish name">
            <input
              id={`dish-${dish.id}-name`}
              value={dish.name}
              onChange={(event) => patch({ name: event.target.value })}
              disabled={readOnly}
              autoComplete="off"
            />
          </Field>
          <Choice
            name={`diet-${dish.id}`}
            legend="Diet"
            value={dish.diet}
            options={DIET_OPTIONS}
            onChange={(diet) => patch({ diet })}
            disabled={readOnly}
          />
          <Choice
            name={`taste-${dish.id}`}
            legend="Sweet or savoury"
            value={dish.taste}
            options={TASTE_OPTIONS}
            onChange={(taste) => patch({ taste })}
            disabled={readOnly}
          />
          <Choice
            name={`spice-${dish.id}`}
            legend="Spice"
            value={dish.spice}
            options={SPICE_OPTIONS}
            onChange={(spice) => patch({ spice })}
            disabled={readOnly}
          />
          <fieldset className="choice" disabled={readOnly}>
            <legend className="label">Allergens</legend>
            <div className="chips">
              {ALLERGENS.map(([key, label]) => (
                <label key={key} className={dish.allergens.includes(key) ? 'chip on' : 'chip'}>
                  <input
                    type="checkbox"
                    checked={dish.allergens.includes(key)}
                    onChange={() => toggleAllergen(key)}
                    disabled={readOnly}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {dish.allergens.includes('other') ? (
            <Field label="Other allergen">
              <input
                value={dish.allergen_other}
                onChange={(event) => patch({ allergen_other: event.target.value })}
                disabled={readOnly}
              />
            </Field>
          ) : null}
          <Choice
            name={`made-${dish.id}`}
            legend="Made by"
            value={dish.made_by}
            options={MADE_OPTIONS}
            onChange={(made_by) => patch({ made_by })}
            disabled={readOnly}
          />
          {dish.made_by === 'caterer' ? (
            <div className="split">
              <Field label="Caterer name">
                <input
                  value={dish.caterer_name}
                  onChange={(event) => patch({ caterer_name: event.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Caterer phone">
                <input
                  value={dish.caterer_contact}
                  onChange={(event) => patch({ caterer_contact: event.target.value })}
                  disabled={readOnly}
                  inputMode="tel"
                />
              </Field>
            </div>
          ) : null}
          <Field label="Target pieces" hint="A whole number for the stall, not per family.">
            <input
              value={dish.target_pieces}
              onChange={(event) => patch({ target_pieces: event.target.value })}
              disabled={readOnly}
              inputMode="numeric"
            />
          </Field>
          <Field label="Limit" hint="The most parents can pledge. Leave blank to use the target.">
            <input
              value={dish.max_quantity}
              onChange={(event) => patch({ max_quantity: event.target.value })}
              disabled={readOnly}
              inputMode="numeric"
            />
          </Field>
          <Field label="Notes">
            <textarea
              rows={3}
              value={dish.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              disabled={readOnly}
            />
          </Field>
        </div>
      ) : dish.notes.trim() ? (
        <p className="dish-note">{dish.notes.trim()}</p>
      ) : null}

      <div className="dish-actions">
        <button type="button" className="btn btn-quiet" onClick={onToggle}>
          {open ? 'Close' : 'Edit'}
        </button>
        {confirmRemove ? (
          <>
            <span>Remove this dish?</span>
            <button type="button" className="btn btn-quiet" onClick={() => onRemove(dish.id)}>
              Remove
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setConfirmRemove(true)}
            disabled={readOnly}
          >
            Remove
          </button>
        )}
      </div>
    </article>
  )
}
