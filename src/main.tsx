import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./ui/App"
import "./ui/styles.css"
import "./ui/music.css"

const root = document.getElementById("root")
if (!root) throw new Error("the page has no #root element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
