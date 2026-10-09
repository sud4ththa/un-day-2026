export function dashboardShell() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<base href="/view/">
<title>Stall responses</title>
<style>
  :root { color-scheme: light; --ink: #111; --mute: #5c5c5c; --hair: #e4e4e4; --paper: #fff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: "Iowan Old Style", Palatino, Georgia, serif; }
  header, main { max-width: 72rem; margin: 0 auto; padding: 1.25rem 1.25rem 0; }
  .bar, button, table, .note, .stat, h3, footer { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .bar { display: flex; justify-content: space-between; gap: 1rem; align-items: center; font-size: .78rem; letter-spacing: .04em; }
  .bar a, .bar button.link { color: inherit; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
  h1 { font-weight: normal; font-size: clamp(2rem, 5vw, 3rem); margin: .2rem 0; }
  .kicker { letter-spacing: .22em; text-transform: uppercase; font-size: .72rem; margin: 1rem 0 0; }
  .note { color: var(--mute); font-size: .85rem; }
  button.solid { background: var(--ink); color: #fff; border: 0; border-radius: 999px; min-height: 44px; padding: 0 1rem; cursor: pointer; }
  button.solid:disabled { opacity: .55; cursor: progress; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: .92rem; }
  th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid var(--hair); vertical-align: top; }
  th { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); }
  section { padding: 1.25rem 0 1.5rem; border-top: 1px solid var(--ink); }
  .stats { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; margin: .5rem 0 1rem; }
  .stat b { display: block; font-size: 1.15rem; font-weight: 600; }
  .stat span { color: var(--mute); font-size: .72rem; letter-spacing: .04em; }
  ul.menu { list-style: none; padding: 0; margin: 0; }
  ul.menu li { display: grid; grid-template-columns: 1fr auto; gap: .5rem; padding: .28rem 0; border-bottom: 1px solid var(--hair); }
  a.pdf { font-family: system-ui, sans-serif; font-size: .85rem; }
  footer { padding: 2rem 1.25rem 2.5rem; color: var(--mute); font-size: .75rem; }
  .status { min-height: 1.2rem; }
</style>
</head>
<body>
<header>
  <div class="bar"><span>Signed in</span><a href="/api/logout">Sign out</a></div>
  <p class="kicker">UN Day 2026</p>
  <h1>Stall responses</h1>
  <p class="note">Friday 16 October 2026. Counts on this page. Names and phones are only in the stall PDF.</p>
  <p><button class="solid" id="refresh" type="button">Refresh now</button></p>
  <p class="status" id="status" role="status"></p>
  <p class="note" id="updated"></p>
</header>
<main id="app"><p class="note">Loading the latest counts.</p></main>
<footer>The British School in Colombo · PTC</footer>
<script>
const app = document.getElementById("app")
const status = document.getElementById("status")
const updated = document.getElementById("updated")
const refreshBtn = document.getElementById("refresh")

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
}
function num(value) {
  return value == null ? "\\u2014" : Number(value).toLocaleString("en-GB")
}
function when(iso) {
  if (!iso) return "\\u2014"
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return esc(iso)
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo", weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(dt).replace("am", "am").replace("pm", "pm")
}

function stallTable(data) {
  const rows = data.stalls.map((stall) => {
    const ok = stall.status === "ok"
    const money = stall.money_only && stall.money && stall.money.known ? "Rs " + Number(stall.money.total).toLocaleString("en-GB") : ""
    const contrib = stall.contribution
    const mix = contrib ? [contrib.Food || 0, contrib["Monetary contribution"] || 0, contrib.Both || 0].join(" \\u00b7 ") : (money || "\\u2014")
    return "<tr><td><a href=\\"#" + esc(stall.slug) + "\\">" + esc(stall.name) + "</a></td><td>"
      + (ok ? num(stall.responses) : "\\u2014") + "</td><td>" + (ok ? num(stall.families) : "\\u2014")
      + "</td><td>" + (ok ? (stall.money_only ? esc(money || mix) : mix) : "\\u2014") + "</td></tr>"
  }).join("")
  return "<table><thead><tr><th>Stall</th><th>Responses</th><th>Families</th><th>Food \\u00b7 money \\u00b7 both</th></tr></thead><tbody>"
    + rows + "</tbody></table>"
}

function section(stall) {
  const ok = stall.status === "ok"
  const bits = []
  bits.push("<section id=\\"" + esc(stall.slug) + "\\"><h2>" + esc(stall.name) + "</h2>")
  if (stall.year_groups) bits.push("<p class=\\"note\\">" + esc(stall.year_groups) + "</p>")
  if (stall.minimum_note) bits.push("<p class=\\"note\\">" + esc(stall.minimum_note) + "</p>")
  if (stall.pdf) bits.push("<p><a class=\\"pdf\\" href=\\"sheets/" + encodeURIComponent(stall.pdf) + "\\">Download this stall</a></p>")
  const stats = stall.money_only
    ? [["Families", ok ? num(stall.families) : "\\u2014"], ["Total pledged", ok && stall.money && stall.money.known ? "Rs " + Number(stall.money.total).toLocaleString("en-GB") : "\\u2014"], ["Received", ok ? num(stall.money && stall.money.buckets && stall.money.buckets.received) : "\\u2014"], ["Pending", ok ? num(stall.money && stall.money.buckets && stall.money.buckets.pending) : "\\u2014"], ["Not marked", ok ? num(stall.money && stall.money.buckets && stall.money.buckets.unmarked) : "\\u2014"]]
    : [["Responses", ok ? num(stall.responses) : "\\u2014"], ["Families", ok ? num(stall.families) : "\\u2014"], ["Last response", ok ? when(stall.last_response) : "\\u2014"]]
  bits.push("<div class=\\"stats\\">" + stats.map(([label, value]) => "<div class=\\"stat\\"><b>" + value + "</b><span>" + esc(label) + "</span></div>").join("") + "</div>")
  if (!stall.money_only) {
    const items = (stall.menu || []).map((item) => "<li><span>" + esc(item.label || item.item) + (item.closed ? " (closed)" : "") + "</span><span>" + esc(item.pledged || "0") + " \\u00b7 " + num(item.count) + "</span></li>").join("")
    bits.push("<h3>Menu</h3><ul class=\\"menu\\">" + items + "</ul>")
    if (stall.money_line) bits.push("<p class=\\"note\\">" + esc(stall.money_line) + "</p>")
  } else if (stall.money && stall.money.by_amount) {
    const bands = stall.money.by_amount.map((band) => "<li><span>" + esc(band.amount) + "</span><span>" + num(band.children) + "</span></li>").join("")
    bits.push("<h3>Amounts</h3><ul class=\\"menu\\">" + bands + "</ul>")
  }
  if (!ok) bits.push("<p class=\\"note\\">Response sheet not connected yet.</p>")
  bits.push("</section>")
  return bits.join("")
}

async function load() {
  const res = await fetch("data.json", { cache: "no-store" })
  if (res.status === 404 || res.status === 503) {
    app.innerHTML = "<p class=\\"note\\">No counts yet. Use Refresh now after the sheet list is set.</p>"
    return
  }
  if (!res.ok) {
    app.innerHTML = "<p class=\\"note\\">The counts could not be opened.</p>"
    return
  }
  const data = await res.json()
  updated.textContent = "Last updated " + when(data.updated) + " (Colombo)"
  const summary = data.summary || {}
  app.innerHTML = "<p class=\\"note\\">" + num(summary.responses) + " responses \\u00b7 " + num(summary.families) + " families \\u00b7 "
    + num(summary.connected) + " of " + num(summary.stalls) + " sheets connected.</p>"
    + stallTable(data) + data.stalls.map(section).join("")
}

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true
  status.textContent = "Refreshing the sheets."
  try {
    const res = await fetch("/api/refresh", { method: "POST" })
    const body = await res.json().catch(() => ({}))
    if (res.status === 429) status.textContent = body.error || "A refresh just ran. Wait a minute."
    else if (!res.ok) status.textContent = body.error || "The refresh could not finish."
    else {
      status.textContent = "Counts updated."
      await load()
    }
  } catch {
    status.textContent = "The refresh could not finish."
  } finally {
    refreshBtn.disabled = false
  }
})
load()
</script>
</body>
</html>`
}
