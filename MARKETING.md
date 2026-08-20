# AQMath Marketing Plan — Substack · Twitter/X · Reddit

**Last updated:** 2026-08-20
**Owner:** Momir Demirov
**Channels:** Substack, Twitter/X, Reddit (only — no other platforms)
**Budget:** $0 (organic only, no ads)

---

## 1. Accounts & Links

| Platform | Handle / URL | Purpose |
|----------|-------------|---------|
| **Substack** | https://substack.com/@aqmathxyz | Long-form articles, research results, transparency reports |
| **Twitter/X** | [@aqmathapp](https://x.com/aqmathapp) | Short insights, charts, threads linking to Substack |
| **Reddit** | [/u/weaforex](https://www.reddit.com/user/weaforex/) | Community discussion, AMAs, crossposts to crypto subs |
| Website | https://aqmath.xyz | Product (beta-gated) |
| Telegram | @DoNotAskMex | Direct contact (not a marketing channel) |

---

## 2. Core Messaging — What Makes AQMath Different

Every piece of content should hit at least ONE of these differentiators:

### 2.1 The Elevator Pitch (1 sentence)

> "AQMath is a non-custodial crypto portfolio rebalancer that uses
> risk-parity math and a drawdown shield to protect you from crashes —
> without ever touching your keys."

### 2.2 Key Differentiators

| # | Claim | Proof |
|---|-------|-------|
| 1 | **Non-custodial** — portfolio stays in your browser | No wallet connect, no accounts, open the code |
| 2 | **Math you can verify** — ERC risk parity + KKT constraints | Backtest page, walk-forward grid, all params visible |
| 3 | **Drawdown protection that actually works** — Deleverage Shield v14 | Crown Tests 1-4, paper trading forward log |
| 4 | **Honest about limitations** — we publish what fails too | Crown Test 2 (2/4 pass), Test 4 (1/4 pass), claims audit |
| 5 | **Privacy-first** — no cookies, no tracking, no PII | Simple Analytics, self-hosted fonts, strict CSP |
| 6 | **One person, not a VC-backed company** — aligned incentives | About page, impressum, solo dev |

### 2.3 Tone of Voice

- **Honest over hype** — never say "guaranteed", "100% safe", or "best"
- **Data over opinion** — every claim links to a test or backtest
- **Self-critical** — publish failures openly (builds trust)
- **Technical but accessible** — explain the math, but always with a
  "what this means for you" summary
- **No FUD** — never bash competitors, just show the numbers

---

## 3. Channel Strategy

### 3.1 Substack — The Home Base

**URL:** https://substack.com/@aqmathxyz
**Cadence:** 1 article per week (minimum), 2 per week when launching
**Format:** Long-form (1,500-3,000 words), data-driven, with charts

#### Content Types

| Type | Frequency | Example |
|------|-----------|---------|
| **Research Results** | Per crown test | "I Tested My Shield Against 5 Strategies — Here's What Won" |
| **Transparency Reports** | Monthly | "August 2026: What the Shield Did and Didn't Do" |
| **Technical Deep-Dives** | Bi-weekly | "How Risk Parity Actually Works (With Code)" |
| **Post-Mortems** | As needed | "When the Signal Was Wrong: A Crash Analysis" |
| **Opinion/Thesis** | Monthly | "Why 60/40 Is Dead for Crypto (And What Replaces It)" |

#### Article Template

```
# [Provocative but honest title]

*[One-paragraph hook — the question you're answering]*

---

## The setup
[What you tested / built / found — 2-3 paragraphs max]

## The method
[How — reproducible details, params, baskets, timeframes]

## The results
[Tables, charts, specific numbers — no vagueness]

## What this means for you
[Plain-language takeaway — what should a reader DO with this info?]

## What I got wrong
[Self-criticism — what the test didn't cover, limitations]

---

*Reproducibility details: [engine version, seeds, params, dates]*
```

#### Existing Content Ready to Publish

| Draft/Source | Article Title | Status |
|-------------|---------------|--------|
| `_research/substack-dca-stress-hr.md` | "I Deliberately Broke My Own System" | ✅ Draft done (EN), needs publish |
| `_research/recovery-test.md` | "The Shield Kicked Me Out — Then I Missed the Rally" | 🔴 Needs writing |
| `_research/static-vs-dynamic.md` | "60/40 vs Shield: I Ran Both for 6.2 Years" | 🔴 Needs writing |
| Crown Test 5 (P0) | "5 Strategies, 1 Winner: The Strategy Benchmark" | 🔴 Needs Test 5 |
| Paper trading data | "Live Track Record: 90 Days of Real Signals" | 🔴 Needs P0-3 |

---

### 3.2 Twitter/X — The Distribution Engine

**Handle:** @aqmathapp
**Cadence:** 3-5 tweets per day, 1 thread per week
**Format:** Short, punchy, always with a link to Substack or aqmath.xyz

#### Content Types

| Type | Format | Example |
|------|--------|---------|
| **Insight tweet** | 1-2 sentences + chart | "Your crypto portfolio's biggest risk isn't the crash. It's the 3 days you waited before cutting exposure. We measured it: +11pp drawdown for a constant 3-day lag." |
| **Thread** | 5-12 tweets | Summary of Substack article with key charts |
| **Data point** | Single stat + context | "Shield v14 MaxDD: 35.0%. Buy & Hold same basket: 58.3%. Same tokens, same period, same DCA." |
| **Build-in-public** | Progress update | "Just finished Crown Test 4. The shield re-enters in 1 day median. But full recovery participation? Only 32%. Re-entry is fast. Catching the rally? Not yet. Working on it." |
| **Quote-tweet** | React to crypto news | When a major crash happens: "This is exactly what the Shield is designed for. Here's what it would have done today: [chart]" |
| **Poll** | Engagement | "What's your biggest portfolio fear? A) Missing the next rally B) The next -50% crash C) Both equally" |

#### Thread Template (for Substack articles)

```
Tweet 1: Hook + "I just published a deep dive on Substack. Thread 🧵"
Tweet 2-3: The problem (why this matters)
Tweet 4-6: The method (what you tested)
Tweet 7-9: The results (key numbers + chart image)
Tweet 10: The takeaway (what this means for you)
Tweet 11: Link to full article + "Link in bio"
```

#### Posting Schedule (UTC)

| Time | Content |
|------|---------|
| 08:00 | Insight tweet or data point (EU morning) |
| 14:00 | Thread or build-in-public (US morning overlap) |
| 18:00 | Engagement tweet (poll, question, quote-tweet) |
| + | React to breaking crypto news in real-time |

---

### 3.3 Reddit — The Trust Builder

**Profile:** /u/weaforex
**Cadence:** 2-3 posts per week, daily comments in relevant threads
**Subreddits:** r/CryptoCurrency, r/defi, r/CryptoMarkets,
r/BitcoinMarkets, r/algotrading, r/passive_income

#### Content Types

| Type | Subreddit | Example |
|------|-----------|---------|
| **Research post** | r/CryptoCurrency, r/algotrading | Full Substack article repost with tl;dr |
| **AMA** | r/CryptoCurrency | "I built a non-custodial risk-parity crypto rebalancer. AMA." |
| **Discussion** | r/defi, r/CryptoMarkets | "How do you handle drawdowns? I tested 5 strategies." |
| **Data share** | r/BitcoinMarkets | "I tracked what happens when you're late executing signals" |
| **Comment** | All subs | Helpful replies to "how do I protect my portfolio" threads |

#### Reddit Rules (CRITICAL)

1. **Never shill** — Reddit detects and destroys marketers. Lead with
   value, mention AQMath only when directly relevant.
2. **Disclose affiliation** — Always mention you're the developer when
   posting about AQMath. Transparency > stealth.
3. **tl;dr first** — Redditors won't read walls of text. Put the
   conclusion at the top.
4. **Engage in comments** — Reply to every comment. Answer criticism
   honestly. "You're right, that's a limitation" builds more trust
   than defending.
5. **Crosspost wisely** — Don't post the same thing to 5 subs on the
   same day. Space it out, tailor the angle.
6. **No links in title** — Reddit's algorithm penalizes external links
   in post titles. Put the link in the first comment.

#### Reddit Post Template

```
Title: [Question or provocative statement — NOT "Check out my app"]

Body:
tl;dr: [1-2 sentence conclusion]

[2-3 paragraphs explaining what you found/built]

[Key data table or chart]

[What this means practically]

---
Full research: [link in first comment]
I'm the developer of AQMath (non-custodial risk-parity rebalancer) — 
happy to answer questions.
```

---

## 4. Content Calendar — First 4 Weeks

### Week 1 (2026-08-21 to 2026-08-27)

| Day | Substack | Twitter | Reddit |
|-----|----------|---------|--------|
| Mon | — | Thread: "Why I stress-tested my own system" | — |
| Tue | Publish: "I Deliberately Broke My Own System" (existing draft) | 3 tweets from article key points | r/algotrading: Research post |
| Wed | — | Insight: MaxDD comparison stat | r/CryptoMarkets: Discussion |
| Thu | — | Build-in-public: Crown Test 5 progress | — |
| Fri | — | Poll: "biggest portfolio fear?" | r/defi: Discussion |
| Sat | — | React to weekend crypto news | — |
| Sun | — | — | — |

### Week 2 (2026-08-28 to 2026-09-03)

| Day | Substack | Twitter | Reddit |
|-----|----------|---------|--------|
| Mon | — | Thread teaser: "Tomorrow: 60/40 vs Shield" | — |
| Tue | Publish: "60/40 vs Shield: 6.2 Years of Data" | Thread from article | r/CryptoCurrency: Research post |
| Wed | — | Data point: recovery participation stat | r/BitcoinMarkets: Discussion |
| Thu | — | Build-in-public: v17 circuit breaker | — |
| Fri | Publish: "Live Track Record: 90 Days" | Thread from paper trading | r/CryptoMarkets: Data share |
| Sat | — | React to news | — |
| Sun | — | — | — |

### Week 3 (2026-09-04 to 2026-09-10)

| Day | Substack | Twitter | Reddit |
|-----|----------|---------|--------|
| Mon | — | Thread: "5 strategies walk into a backtest" | — |
| Tue | Publish: "5 Strategies, 1 Winner" (Crown Test 5) | Thread from article | r/algotrading + r/CryptoCurrency |
| Wed | — | Chart: equity curve overlay | r/defi: Discussion |
| Thu | — | Build-in-public: what's next | — |
| Fri | Publish: "How Risk Parity Works (With Code)" | Thread teaser | r/algotrading: Technical |
| Sat | — | React to news | — |
| Sun | — | — | — |

### Week 4 (2026-09-11 to 2026-09-17)

| Day | Substack | Twitter | Reddit |
|-----|----------|---------|--------|
| Mon | — | Poll: "do you rebalance?" | — |
| Tue | Publish: Monthly Transparency Report | Thread highlights | r/CryptoCurrency: AMA announcement |
| Wed | — | Insight: best-performing tweet | — |
| Thu | — | Build-in-public | — |
| Fri | AMA on Reddit | Cross-promote AMA on Twitter | r/CryptoCurrency: AMA |
| Sat | — | React to news | Reply to AMA comments |
| Sun | — | — | — |

---

## 5. Cross-Posting Workflow

Every Substack article follows this pipeline:

```
1. Write Substack article (long-form, data-rich)
        │
        ├──→ Twitter thread (same day, 5-12 tweets with charts)
        │       │
        │       └──→ Individual tweets spread over 2-3 days
        │
        ├──→ Reddit post (next day, tl;dr + full link in comment)
        │       │
        │       └──→ Crosspost to 2-3 subreddits over the week
        │
        └──→ Twitter bio link update (if new permanent page)
```

### Repurposing Matrix

| Substack Article | → Twitter | → Reddit |
|-----------------|-----------|----------|
| Research result | Thread with key chart + stats | Full post with tl;dr |
| Transparency report | Top 3 insights as separate tweets | Discussion post |
| Technical deep-dive | "Here's how X works in 60 seconds" | r/algotrading technical post |
| Opinion/thesis | Hot take + poll | Discussion starter |

---

## 6. Key Metrics to Track

| Metric | Platform | Tool | Target (Month 1) |
|--------|----------|------|-------------------|
| Substack subscribers | Substack | Dashboard | 100 |
| Article reads | Substack | Dashboard | 500 total |
| Twitter followers | Twitter/X | Profile | 200 |
| Avg. tweet impressions | Twitter/X | Analytics | 500 |
| Thread completion rate | Twitter/X | Analytics | >30% |
| Reddit karma | Reddit | Profile | +500 |
| Reddit post upvotes | Reddit | Per post | >20 avg |
| Beta key activations | aqmath.xyz | beta-auth DB | 5 new/week |
| Website visits | aqmath.xyz | Simple Analytics | 1,000/week |

---

## 7. Hashtags & Keywords

### Twitter Hashtags (use 1-2 per tweet, never more)

Primary: `#CryptoPortfolio` `#RiskParity` `#DeFi` `#DCA`
Secondary: `#CryptoTrading` `#PortfolioManagement` `#Drawdown`
Niche: `#BuildInPublic` `#IndieHacker` `#OpenSource`

### Reddit Keywords (for searchability in posts)

risk parity, portfolio rebalancing, drawdown protection, DCA strategy,
crypto portfolio, non-custodial, backtest results, crypto risk management

### SEO Keywords (for Substack article titles and headers)

crypto portfolio rebalancer, risk parity crypto, drawdown protection,
crypto DCA strategy, DeFi portfolio management, non-custodial portfolio

---

## 8. Competitor Positioning

**Never name competitors negatively.** Instead, position by contrast:

| They Do | AQMath Does |
|---------|-------------|
| Custodial (they hold your keys) | Non-custodial (portfolio in YOUR browser) |
| Black-box algorithms | Every parameter visible, every test published |
| Monthly fees | Free during beta |
| Centralized servers | 10 services, all open architecture |
| "Trust us" | "Verify it yourself" |
| Binary signals (buy/sell) | Continuous exposure (smooth, no whipsaw) |

---

## 9. Crisis Communication

When the market crashes >20% in a day (and it will):

```
Timeline:
  0-1h:   Tweet: "We see the drop. Here's what the Shield is doing: [status]"
  1-4h:   Tweet: chart showing Shield's response vs B&H
  24h:    Substack: "What Just Happened: [Date] Crash Analysis"
  48h:    Reddit: Data post with full numbers

Key rules:
  - NEVER say "told you so" or "if you were using AQMath..."
  - ALWAYS show data, not opinions
  - Be honest if the Shield didn't help (it might not have)
  - Update the paper trading forward log within 24h
```

---

## 10. Quick-Start Checklist (First 48 Hours)

- [ ] Publish existing Substack draft ("I Deliberately Broke My Own System")
- [ ] Pin tweet with link to Substack
- [ ] Set Twitter bio: "Non-custodial crypto portfolio rebalancer. Risk-parity math + drawdown shield. Building in public."
- [ ] Post first Reddit thread in r/algotrading
- [ ] Start Crown Test 5 (P0-1) — it's the #1 marketing blocker
- [ ] Create Twitter list of crypto quant/portfolio accounts to engage with
- [ ] Set up Substack email notification for new posts
- [ ] Write 5 draft tweets for the week
