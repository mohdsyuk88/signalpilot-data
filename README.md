# signalpilot-data

Public market data and model numbers for the SignalPilot app (the app's source is in a private repo).

* `book/<date>.jsonl`: order-book imbalance, open interest and funding per coin every 5 minutes, recorded by `.github/workflows/collect.yml`
  (`collect.mjs`). Public exchange data, kept for an out-of-sample test of whether order-book imbalance predicts the next hour.
* `calibration.json`: the model numbers installed apps download (see below). Written by the app repo's release workflow.
* `news/<date>.jsonl`: crypto headlines (title, link, publish time, time first seen) from public RSS feeds (Cointelegraph, Decrypt, The Block, CoinDesk),
  recorded every 20 minutes by `.github/workflows/news.yml` (`news.mjs`). RSS keeps only the latest few hours, so there is no history to download later.
  Kept for a future out-of-sample test of whether headline volume or tone predicts the next hour.
