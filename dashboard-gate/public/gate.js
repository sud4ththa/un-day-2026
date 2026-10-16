const choices = document.getElementById("choices")
const form = document.getElementById("code-form")
const codeInput = document.getElementById("code")
const status = document.getElementById("status")
const prompt = document.getElementById("prompt")
const back = document.getElementById("back")
let who = ""

function setStatus(message, isError) {
  status.textContent = message || ""
  status.classList.toggle("error", Boolean(isError))
}

function showChoices() {
  who = ""
  choices.hidden = false
  form.hidden = true
  codeInput.value = ""
  prompt.textContent = "Choose your name. A code will come by text message."
  setStatus("")
  for (const button of choices.querySelectorAll("button")) button.disabled = false
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  let data = {}
  try {
    data = await res.json()
  } catch {
    data = {}
  }
  return { res, data }
}

choices.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-who]")
  if (!button) return
  who = button.getAttribute("data-who")
  for (const item of choices.querySelectorAll("button")) item.disabled = true
  setStatus("Sending a code…")
  try {
    const { res, data } = await post("/api/send", { who })
    if (!res.ok || !data.ok) {
      setStatus(data.error || "The code could not be sent.", true)
      for (const item of choices.querySelectorAll("button")) item.disabled = false
      return
    }
    choices.hidden = true
    form.hidden = false
    prompt.textContent = `Enter the code sent to ${data.masked || "your mobile"}.`
    setStatus("")
    codeInput.focus()
  } catch {
    setStatus("The code could not be sent. Try again in a minute.", true)
    for (const item of choices.querySelectorAll("button")) item.disabled = false
  }
})

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const submit = form.querySelector("button[type=submit]")
  submit.disabled = true
  setStatus("Checking…")
  try {
    const { res, data } = await post("/api/verify", { who, code: codeInput.value })
    if (!res.ok || !data.ok) {
      setStatus(data.error || "That code is not right.", true)
      submit.disabled = false
      codeInput.focus()
      return
    }
    window.location.assign("/view/")
  } catch {
    setStatus("The code could not be checked. Try again.", true)
    submit.disabled = false
  }
})

back.addEventListener("click", showChoices)

fetch("/api/session").then(async (res) => {
  if (!res.ok) return
  const data = await res.json()
  if (data.ok) window.location.assign("/view/")
}).catch(() => {})
