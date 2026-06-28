import { render, screen } from "@testing-library/react"
import { App } from "./App.tsx"

describe("App", () => {
  it("renders the scaffold heading and button", () => {
    render(<App />)
    expect(
      screen.getByRole("heading", { name: "Project ready!" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Button" })).toBeInTheDocument()
  })

  it("shows the env from the runtime-config fallback", () => {
    render(<App />)
    // No window.__APP_CONFIG__ in jsdom, so getConfig() returns the "local" fallback.
    expect(screen.getByText("local")).toBeInTheDocument()
  })
})
