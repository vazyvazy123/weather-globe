import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { landRings } from "./globe/landMask"
import { App } from "./ui/App"
import "./ui/styles.css"
import "./ui/music.css"

// the coastline (the largest download, its own file, which index.html asks for alongside the code) is read first: it
// is unpacked while the app starts. Should it fail, the globe asks again as it is made, and meets the error there.
landRings().catch(() => {})

const root = document.getElementById("root")
if (!root) throw new Error("the page has no #root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
