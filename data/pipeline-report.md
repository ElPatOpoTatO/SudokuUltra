# Puzzle pipeline report

- Seed: `20261112`  mode: full
- Generated: 2026-11-12T14:59:52.043Z
- Candidates generated: 8635 (duplicates rejected by canonical form: 0)
- Time: generation 10.4 s, validation 1.9 s, total 13.2 s
- Output: `data/puzzles.json` 291.2 KB; `data/backlog.json` 192.4 KB
- Validation: all checks passed (1440 items); solver tests pass

## Stock

"Offered" = candidates evaluated against the pool while it was still open (every candidate is offered to all open pools in priority order: campaign, quick, daily, backlog). "Per accepted" = offered / found.

| Pool | Found / needed | Offered | Per accepted | Clues |
|---|---|---|---|---|
| W0 Spot it | 12 / 12 | 4180 | - | snapshots considered |
| W0 Use it | 12 / 12 | 192 | 16.0 | 56-71 |
| W0 Master | 4 / 4 | 55 | 13.8 | 36-40 |
| W1 Spot it | 12 / 12 | 6262 | - | snapshots considered |
| W1 Use it | 12 / 12 | 3677 | 306.4 | 38-42 |
| W1 Master | 4 / 4 | 62 | 15.5 | 23-28 |
| W2 Spot it | 12 / 12 | 482 | - | snapshots considered |
| W2 Use it | 12 / 12 | 119 | 9.9 | 26-31 |
| W2 Master | 4 / 4 | 1912 | 478.0 | 25-29 |
| W3 Spot it | 12 / 12 | 1413 | - | snapshots considered |
| W3 Use it | 12 / 12 | 255 | 21.3 | 23-32 |
| W3 Master | 4 / 4 | 213 | 53.3 | 23-29 |
| W4 Spot it | 12 / 12 | 379 | - | snapshots considered |
| W4 Use it | 12 / 12 | 224 | 18.7 | 23-31 |
| W4 Master | 4 / 4 | 1378 | 344.5 | 24-30 |
| Quick gentle | 150 / 150 | 387 | 2.6 | 28-38 |
| Quick easy | 150 / 150 | 977 | 6.5 | 23-34 |
| Quick medium | 150 / 150 | 2001 | 13.3 | 22-31 |
| Quick tricky | 150 / 150 | 5181 | 34.5 | 22-32 |
| Daily gentle | 58 / 58 | 342 | 5.9 | 28-38 |
| Daily easy | 114 / 114 | 1565 | 13.7 | 22-33 |
| Daily medium | 114 / 114 | 3201 | 28.1 | 22-30 |
| Daily tricky | 114 / 114 | 7669 | 67.3 | 22-32 |
| Backlog (> W4) | 300 / 300 | 747 | 2.5 | 22-32 |

## Rules used

- W0 Use it: solvable with W0+W1, >= 70% of steps are full house, 10-25 empty cells. Master: solvable with W0+W1, 36-40 clues, >= 90% of steps are full house or hidden single (box), >= 3 full houses.
- W1 Use it: belongs to W1, 38-46 clues, >= 1 hidden single (row/column). Master: belongs to W1, <= 30 clues, >= 20 hidden singles of which >= 4 row/column, >= 1 full house.
- W2 Use it: belongs to W2, 26-36 clues, 1-3 naked singles. Master: belongs to W2, <= 30 clues, >= 6 naked singles.
- W3 Use it: belongs to W3, 1-3 pointing/claiming steps. Master: belongs to W3, <= 30 clues, >= 3 pointing/claiming steps, >= 1 naked single.
- W4 Use it: belongs to W4, 1-3 pair steps. Master: belongs to W4, <= 30 clues, >= 3 pair steps, >= 1 pointing/claiming step.
- Quick/Daily bands: gentle = belongs to W0/W1 (28-38 clues), easy = W2, medium = W3, tricky = W4.
- Daily rhythm (day 0 = Monday): Mon gentle, Tue-Wed easy, Thu-Fri medium, Sat-Sun tricky.

## Spot it

- W0: 12/12 from 4180 snapshots — full-house-col 4, full-house-box 4, full-house-row 4
- W1: 12/12 from 6262 snapshots — hidden-single-line-col 3, hidden-single-box-box 6, hidden-single-line-row 3
- W2: 12/12 from 482 snapshots — naked-single 12
- W3: 12/12 from 1413 snapshots — claiming-row 3, pointing-col 3, pointing-row 3, claiming-col 3
- W4: 12/12 from 379 snapshots — naked-pair-row 2, hidden-pair-col 2, naked-pair-col 3, hidden-pair-row 2, naked-pair-box 1, hidden-pair-box 2

## Shortfalls

None.
