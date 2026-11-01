// Open-Meteo's free use allows 600 calls a minute, each location in a request counted as a call. The page's reads are
// counted here: the cities' and the clouds' (which cannot wait) are only counted; the wind's (which can) is asked for
// only when the last minute's calls leave room for it under BUDGET — so turning the wind on never pushes the page past
// the limit and costs the cities their weather.

/** the calls the page lets itself make in any minute (Open-Meteo's limit is 600) */
export const BUDGET = 560
const WINDOW_MS = 60_000

export class CallBudget {
  /** the calls made in the last minute, oldest first */
  private readonly spent: Array<{ at: number; n: number }> = []

  constructor(private readonly budget = BUDGET) {}

  /** `n` calls made at `now` */
  spend(n: number, now = Date.now()): void {
    this.spent.push({ at: now, n })
  }

  /** How long until `n` more calls fit in the minute's room (ms; 0 = now). A request larger than the whole budget waits
   *  for an empty minute. */
  waitFor(n: number, now = Date.now()): number {
    while (this.spent.length && this.spent[0].at <= now - WINDOW_MS) this.spent.shift()
    const need = Math.min(n, this.budget)
    let used = this.spent.reduce((sum, c) => sum + c.n, 0)
    if (used + need <= this.budget) return 0
    for (const c of this.spent) {
      used -= c.n
      if (used + need <= this.budget) return c.at + WINDOW_MS - now
    }
    return WINDOW_MS
  }
}

/** the page's own count */
export const meteoBudget = new CallBudget()
