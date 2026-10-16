import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { MONEY, parseRupees, rs } from "./aggregate.mjs"

const INK = rgb(0.067, 0.067, 0.067)
const MUTE = rgb(0.4, 0.4, 0.4)

function pdfSafe(value) {
  return String(value ?? "")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2026", "...")
    .replaceAll("\u00a0", " ")
    .replace(/[^\x20-\x7e]/g, "?")
}

function dash(value) {
  if (value == null || value === "") return "-"
  return pdfSafe(value)
}

function contactCells(row, kind) {
  const amount = parseRupees(row.amount || "")
  if (kind === "money") {
    return [
      dash(row.parent),
      dash(row.child),
      dash(row.class),
      dash(amount ? rs(amount) : ""),
      dash(row.pay_status),
      dash(row.slip),
      dash(row.phone),
    ]
  }
  const labels = [...(row.labels || []), ...(row.unlisted || [])]
  let item = labels.join(", ")
  if (!item) item = row.type === MONEY || row.type === "Both" || amount ? "Monetary contribution" : "-"
  else if (row.type === "Both") item = `${item} - food and money`
  if (amount) item = item === "-" ? rs(amount) : `${item} - ${rs(amount)}`
  return [dash(row.parent), dash(row.child), dash(row.class), pdfSafe(item), dash(row.notes), dash(row.phone)]
}

function wrap(text, font, size, width) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean)
  if (!words.length) return [""]
  const lines = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

function drawLines(page, font, lines, x, y, size, color, leading) {
  let cursor = y
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size, font, color })
    cursor -= leading
  }
  return cursor
}

export async function renderStallPdf(model) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const kind = model.money_only || model.kind === "money" ? "money" : "food"
  const portrait = doc.addPage([595.28, 841.89])
  let y = 800
  const center = (page, text, size, face, color) => {
    const width = face.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font: face, color })
    y -= size + 6
  }
  center(portrait, "UN Day 2026", 9, font, MUTE)
  center(portrait, pdfSafe(model.name), 18, bold, INK)
  if (model.years) center(portrait, pdfSafe(model.years), 11, font, INK)
  center(portrait, `Updated ${pdfSafe(model.as_of || "-")}, Colombo`, 9, font, MUTE)
  y -= 8
  portrait.drawText("Page 1. Targets, pledges, and totals", { x: 40, y, size: 10, font: bold, color: INK })
  y -= 16

  const statLine = (label, value) => {
    portrait.drawText(pdfSafe(`${label}: ${value}`), { x: 40, y, size: 10, font, color: INK })
    y -= 14
  }
  if (kind === "money") {
    const money = model.money || {}
    const buckets = money.buckets || {}
    statLine("Families", model.connected ? String(money.families ?? model.families ?? 0) : "-")
    statLine("Total pledged", model.connected && money.known ? rs(money.total) : "-")
    statLine("Last response", model.last_response || "-")
    statLine("Received", model.connected ? String(buckets.received ?? 0) : "-")
    statLine("Pending", model.connected ? String(buckets.pending ?? 0) : "-")
    statLine("Not marked", model.connected ? String(buckets.unmarked ?? 0) : "-")
    y -= 6
    portrait.drawText("Amounts pledged", { x: 40, y, size: 10, font: bold, color: INK })
    y -= 14
    for (const band of money.by_amount || []) {
      portrait.drawText(pdfSafe(`${band.amount}  x ${band.children}`), { x: 40, y, size: 10, font, color: INK })
      y -= 13
    }
    if (model.minimum_note) {
      y = drawLines(portrait, font, wrap(model.minimum_note, font, 9, 500), 40, y, 9, MUTE, 12)
    }
  } else {
    statLine("Responses", model.connected ? String(model.responses ?? 0) : "-")
    statLine("Families", model.connected ? String(model.families ?? 0) : "-")
    statLine("Last response", model.last_response || "-")
    const contrib = model.contribution
    if (contrib) {
      statLine("Food", model.connected ? String(contrib.Food ?? 0) : "-")
      statLine("Monetary contribution", model.connected ? String(contrib[MONEY] ?? 0) : "-")
      statLine("Both", model.connected ? String(contrib.Both ?? 0) : "-")
    }
    if (model.money_line) {
      y -= 4
      y = drawLines(portrait, font, wrap(model.money_line, font, 10, 515), 40, y, 10, INK, 13)
    }
    y -= 6
    let glance = portrait
    glance.drawText("Targets vs pledged", { x: 40, y, size: 10, font: bold, color: INK })
    y -= 14
    const targets = model.targets || []
    for (const target of targets) {
      const line = `${target.label}  needed ${target.needed}  pledged ${target.total}  ${target.pct}  ${target.status}`
      const lines = wrap(line, font, 8, 515)
      if (y < 48 + lines.length * 11) {
        glance = doc.addPage([595.28, 841.89])
        y = 800
      }
      y = drawLines(glance, font, lines, 40, y, 8, target.status === "Open" ? MUTE : INK, 11)
    }
  }

  const contacts = model.contacts || []
  const headers = kind === "money"
    ? ["Parent", "Child", "Class", "Amount", "Status", "Slip / receipt", "Phone"]
    : ["Parent", "Child", "Class", "Item(s) / amount", "Notes", "Phone"]
  const widths = kind === "money" ? [110, 100, 55, 70, 90, 150, 90] : [110, 100, 70, 180, 175, 90]
  let page = doc.addPage([841.89, 595.28])
  y = 560
  const section = (text, size, face, color) => {
    page.drawText(pdfSafe(text), { x: 36, y, size, font: face, color })
    y -= size + 6
  }
  section("Page 2. Contacts for PTC follow-up", 9, font, MUTE)
  section(model.name, 14, bold, INK)
  section(
    model.connected ? `${contacts.length} response(s) as of ${model.as_of || "-"}` : "No response sheet in this refresh",
    9,
    font,
    MUTE,
  )
  y -= 4
  const drawHeader = () => {
    let x = 36
    headers.forEach((label, i) => {
      page.drawText(label, { x, y, size: 8, font: bold, color: INK })
      x += widths[i]
    })
    y -= 12
  }
  drawHeader()
  if (!contacts.length) {
    page.drawText("No responses yet.", { x: 36, y, size: 10, font, color: INK })
  }
  for (const row of contacts) {
    const cells = contactCells(row, kind).map((cell, i) => wrap(cell, font, 8, widths[i] - 8))
    const height = Math.max(...cells.map((lines) => lines.length)) * 10
    if (y - height < 36) {
      page = doc.addPage([841.89, 595.28])
      y = 560
      drawHeader()
    }
    let x = 36
    cells.forEach((lines, i) => {
      let lineY = y
      for (const line of lines) {
        page.drawText(line, { x, y: lineY, size: 8, font, color: INK })
        lineY -= 10
      }
      x += widths[i]
    })
    y -= height + 4
  }
  doc.setTitle(pdfSafe(`UN Day 2026 - ${model.name}`))
  return doc.save()
}
