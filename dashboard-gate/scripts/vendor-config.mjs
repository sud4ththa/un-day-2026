import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "../..")
const outDir = join(here, "../netlify/functions/lib/vendor")

const stalls = JSON.parse(readFileSync(join(root, "scripts/dashboard-stalls.json"), "utf8"))
const forms = {}
for (const raw of readFileSync(join(root, "forms.txt"), "utf8").split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith("#")) continue
  const parts = line.split("|").map((part) => part.trim())
  if (!parts[0] || !parts[1]) continue
  forms[parts[0]] = {
    name: parts[1],
    years: parts[3] || "",
    note: parts[4] || "",
  }
}

let tracker = ""
for (const raw of readFileSync(join(root, "tracker.txt"), "utf8").split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith("#")) continue
  if (line.startsWith("https://") && !/\s/.test(line)) tracker = line
  break
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "stalls.json"), JSON.stringify(stalls))
writeFileSync(join(outDir, "forms.json"), JSON.stringify(forms))
writeFileSync(join(outDir, "tracker.json"), JSON.stringify({ url: tracker }))
