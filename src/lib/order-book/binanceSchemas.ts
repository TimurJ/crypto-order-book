// Zod schemas for the two Binance payloads the sync layer consumes: the diff-depth
// stream frame and the REST depth snapshot. Verified against the raw spec
// (binance-spot-api-docs) and a live stream probe — see docs/order-book-sync-architecture.md.
//
// Deliberately NOT .strict(): unknown extra keys are ignored, so Binance adding a field
// is a non-event. Strictness here rejects only what would break the engine — wrong types,
// missing IDs, malformed level tuples. Prices/quantities stay strings end-to-end (exact
// decimals; parsing to float would corrupt level identity).

import { z } from "zod"

/** `[price, quantity]` — both canonical decimal strings, quantity absolute (not a delta). */
// Not bare z.string(): "" / " " / "abc" would pass, then Number() yields a phantom-delete 0
// (empty qty) or a NaN that corrupts selectTopLevels' comparator and the whole sort. A plain
// Number()-finite check isn't enough either — it accepts " 100 " / "1e3" / "0x10" / "+100" while
// the RAW string is what keys the book's Map, so validation would normalize what storage keeps
// verbatim (the same price in two forms → a ghost level). A canonical fixed-decimal regex closes
// that gap: it rejects those exotic forms and all the garbage, while "0" / "0.00000000" still pass
// (legit zero-qty deletes). This is the "malformed level tuple" rejection the module comment
// promises — a bad frame is dropped and the continuity check heals if it mattered.
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, { message: "not a canonical decimal string" })
export const depthLevelSchema = z.tuple([decimalString, decimalString])

export const depthUpdateSchema = z.object({
  e: z.literal("depthUpdate"),
  E: z.number().int(),
  s: z.string(),
  U: z.number().int(),
  u: z.number().int(),
  b: z.array(depthLevelSchema),
  a: z.array(depthLevelSchema),
})

export const depthSnapshotSchema = z.object({
  lastUpdateId: z.number().int(),
  bids: z.array(depthLevelSchema),
  asks: z.array(depthLevelSchema),
})

export type DepthLevel = z.infer<typeof depthLevelSchema>
export type DepthUpdate = z.infer<typeof depthUpdateSchema>
export type DepthSnapshot = z.infer<typeof depthSnapshotSchema>
