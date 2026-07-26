// Segmented All / Bids / Asks control (design handoff). Single-select on the vendored
// shadcn toggle-group; Base UI models single-select as a one-element value array, and an
// empty array means "the pressed item was clicked again" — we swallow that so exactly
// one view is always active (the design has no unfiltered-off state). The side items
// take the design's buy/sell tones when pressed (solid --bid/--ask fill).

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"

export type BookViewFilter = "all" | "bids" | "asks"

interface ViewToggleProps {
  value: BookViewFilter
  onChange: (value: BookViewFilter) => void
}

const PRESSED_TONE: Record<BookViewFilter, string> = {
  all: "aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm",
  bids: "aria-pressed:bg-bid aria-pressed:text-bid-foreground",
  asks: "aria-pressed:bg-ask aria-pressed:text-ask-foreground",
}

const LABELS: Record<BookViewFilter, string> = {
  all: "All",
  bids: "Bids",
  asks: "Asks",
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <ToggleGroup
      aria-label="Book sides shown"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0]
        if (picked) onChange(picked as BookViewFilter)
      }}
      spacing={0.5}
      className="rounded-md bg-muted p-0.5"
    >
      {(["all", "bids", "asks"] as const).map((view) => (
        <ToggleGroupItem
          key={view}
          value={view}
          size="sm"
          className={`rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-all duration-150 hover:bg-transparent hover:text-foreground active:translate-y-px motion-reduce:transition-none ${PRESSED_TONE[view]}`}
        >
          {LABELS[view]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
