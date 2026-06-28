import { fireEvent, render, screen } from "@testing-library/react"

import { RootErrorBoundary } from "./root-error-boundary.tsx"

// When the boundary catches an error, React logs it to console.error ("The above error
// occurred…") and so does our reportError seam. Silence console.error for these tests so the
// suite output stays clean; restore it afterwards.
const originalConsoleError = console.error
beforeEach(() => {
  console.error = () => {}
})
afterEach(() => {
  console.error = originalConsoleError
})

describe("RootErrorBoundary", () => {
  it("renders the fallback when a child throws", () => {
    function Boom(): never {
      throw new Error("boom")
    }

    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>
    )

    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("recovers when the error clears and Try again is clicked", () => {
    let shouldThrow = true
    function MaybeBoom() {
      if (shouldThrow) {
        throw new Error("boom")
      }
      return <div>Recovered content</div>
    }

    render(
      <RootErrorBoundary>
        <MaybeBoom />
      </RootErrorBoundary>
    )

    expect(screen.getByText("Something went wrong")).toBeInTheDocument()

    // Clear the failure condition, then reset the boundary via the fallback's button.
    shouldThrow = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(screen.getByText("Recovered content")).toBeInTheDocument()
  })
})
