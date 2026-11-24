# Steam Market: old-style front page

Steam's new Community Market page (November 2026) moved **My Active Listings**, **My Buy Orders** and **My Market History** off the front page. This userscript puts them back where they were, as the old tabbed block under the "You have N active sell listings" bar.

## What you get

- **My Active Listings**: listings awaiting confirmation, on hold and live, with the item picture, the date listed, the buyer's price and what you receive, and a **Remove** button.
- **My Buy Orders**: quantity left, price and a **Cancel** button.
- **My Market History**: what you listed, sold, bought and cancelled, with amounts, and **Load more**.
- A name filter, sortable columns (newest, oldest, name, price) and a Refresh button. Your last tab and sort are remembered.
- Prices in your own wallet currency.

Remove and Cancel each ask you to confirm first.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open [steam-old-market.user.js](https://raw.githubusercontent.com/JA-Marshall/steam-old-market/main/steam-old-market.user.js) and click **Install**.
3. Go to https://steamcommunity.com/market/ while signed in.

Updates come through your userscript manager from this repository.

## Privacy

The script only talks to steamcommunity.com, with your existing Steam sign-in, using the same endpoints the old page used:

| Request | Used for |
| --- | --- |
| `GET /market/mylistings?norender=1` | your listings and buy orders |
| `GET /market/myhistory?norender=1` | your market history |
| `POST /market/removelisting/<id>` | Remove (only when you click it and confirm) |
| `POST /market/cancelbuyorder/` | Cancel (only when you click it and confirm) |

It sends nothing anywhere else and has no analytics. It reads pages 1.5 seconds apart so Steam doesn't rate limit you.

## What it can't bring back

The old page's "popular items" and "recently sold" lists. Steam no longer serves them.

## Licence

MIT, see [LICENSE](LICENSE).
