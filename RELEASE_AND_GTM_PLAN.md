# Supercheck Release And GTM Plan

Last updated: 2026-04-17

This document summarizes:

- whether Supercheck should move to production now
- what must be fixed before a broader launch
- the best near-term marketing and sales motion
- whether to register an India entity now
- how to get the first paid users

## Executive Summary

Supercheck looks strong enough for a staged production rollout, but not for a broad GA-style push yet.

The right move is:

1. Run a 1-2 week hardening sprint.
2. Ship a stable production tag, not a canary build.
3. Roll out to a small group of design partners or early paid customers.
4. Use founder-led sales and founder-led marketing first.
5. Register an India company before broad paid rollout, annual contracts, or hiring.

## Current Recommendation

### Recommendation

Move toward production now, but do it as a controlled launch.

### Why

Positive signals:

- The project already has real open-source pull and user interest.
- The product story is differentiated: Playwright + k6 + monitoring + status pages + self-hosting.
- The production app endpoint is live and healthy.
- The cluster already has several production-grade controls in place:
  - NetworkPolicies
  - ResourceQuota for execution
  - KEDA
  - gVisor runtime for execution
  - Monitoring stack

Reasons not to call it broad production yet:

- The live app and worker are still running `1.3.4-canary.1`.
- The user-facing app is single replica.
- Redis and Redis Sentinel are all concentrated on a single node.
- Only the EU worker is active; US and APAC workers are paused.
- App logs show repeated Next.js Server Action mismatch errors.
- Worker logs show repeated Kubernetes log-stream startup warnings.
- Full E2E is disabled in CI and worker lint is skipped.

## Production Blockers To Fix First

### Blockers

1. Stop serving production traffic from canary images.
2. Fix the Next.js Server Action mismatch issue before bigger traffic hits the app.
3. Fix or reduce the worker log-stream warning flood.
4. Add app-plane redundancy or accept that one app node failure is a full outage.
5. Revisit Redis placement and storage strategy.
6. Turn on at least the regions you intend to market.
7. Re-enable stronger release verification in CI.

### Concrete findings from the current cluster

- `supercheck-app` is running `ghcr.io/supercheck-io/supercheck/app:1.3.4-canary.1`
- `supercheck-worker-eu` is running `ghcr.io/supercheck-io/supercheck/worker:1.3.4-canary.1`
- App deployment is `1` replica.
- Redis pods `redis-0`, `redis-1`, `redis-2` are all on `supercheck-prod-app-1`.
- All three `redis-sentinel` pods are also on `supercheck-prod-app-1`.
- Storage class is `local-path`, so Redis storage is node-local.
- US and APAC worker deployments are `0/0` and their KEDA scaled objects are paused.
- App logs contain repeated `Failed to find Server Action` and `Invalid Server Actions request` errors.
- Worker logs contain repeated `Failed to start log stream ... HTTP-Code: 400` warnings for execution pods.

## Hardening Sprint Plan

### Week 1

- Promote a stable release tag and deploy stable images only.
- Fix the Server Action mismatch behavior.
- Investigate the service worker caching policy for Next.js assets and deploy invalidation strategy.
- Investigate the worker Kubernetes log-stream startup behavior.
- Re-enable worker lint or explicitly document why it is still disabled.
- Turn on a release candidate soak environment or limited-customer cohort.

### Week 2

- Add a second app node and move to at least `2` app replicas if possible.
- Spread stateful components or accept/document current HA limits.
- Decide the real production region story:
  - EU only for now, or
  - EU + US, or
  - EU + US + APAC
- Re-enable or replace the disabled full E2E gate.
- Run restore drills for database/object-storage backups.

## Launch Strategy

### What kind of launch to run

Do not run a “big announcement first” launch.

Run this sequence instead:

1. Production candidate
2. Stable release
3. Small paid cohort
4. Public production announcement

### Positioning

Lead with one wedge:

`Self-hosted reliability as code for Playwright, k6, uptime monitoring, and status pages.`

Do not lead with every feature. The current strongest angle is not “AI platform.” It is “one self-hosted control plane for testing + monitoring + status.”

### Public launch channels

- GitHub release
- GitHub release discussion
- Show HN
- Reddit communities relevant to self-hosting and DevOps
- Playwright and k6 communities
- LinkedIn founder posts
- Direct outreach to engineering leaders already using Playwright, k6, or status-page tooling

## Should You Register A Company In India?

### Short answer

Yes, probably before the broad production launch.

### My recommendation

For Supercheck, I would generally recommend an Indian `Private Limited Company`, not an LLP, if your goal is:

- recurring SaaS revenue
- enterprise contracts
- international customers
- future fundraising
- hiring employees
- issuing ESOPs later

This is an inference based on the kind of business Supercheck appears to be building, not legal advice.

### When to register

Register before one of these happens:

- you start onboarding multiple paid customers
- you sign annual contracts
- you want clean invoicing and accounting
- you hire employees or contractors in a regular way
- you want to raise money

If you are only testing a handful of early design partners for a very short period, you can delay slightly. But for a production SaaS business, delaying too long creates avoidable tax, compliance, banking, and contract mess.

## India Company Registration Process

This section is high-level and should be validated with a CA or CS before filing.

### Typical structure for Supercheck

- Entity: Private Limited Company
- Founders: usually 2 directors is the cleanest setup, though structures vary
- Incorporation route: MCA `SPICe+` workflow on the MCA V3 portal

### High-level process

1. Decide founders, shareholding, and authorized capital.
2. Obtain Digital Signature Certificates from a licensed Certifying Authority.
3. Create or use MCA portal accounts and start the incorporation workflow.
4. Reserve the company name in `SPICe+ Part A`, or file Part A and Part B together.
5. Complete `SPICe+ Part B` for incorporation details.
6. File the linked forms such as `eMoA`, `eAoA`, `AGILE-PRO-S`, and `INC-9` where applicable.
7. Upload digitally signed forms on MCA and pay fees.
8. On approval, receive Certificate of Incorporation and linked registrations such as PAN and TAN.

### What SPICe+ covers

Per MCA materials, SPICe+ handles name reservation and incorporation, and links company registration with items such as:

- DIN allotment
- PAN
- TAN
- EPFO
- ESIC
- bank account request
- GSTIN if applied for

### Practical founder checklist before filing

- Final founder share split
- Director details and KYC docs
- Registered office plan and proof
- Final company name options
- Short business object description
- Cap table and vesting plan
- Basic founder agreement

### What to do after incorporation

- Open the operating bank account
- Set up accounting and bookkeeping
- Set up contracts, invoicing, and privacy/terms
- Confirm GST and export-of-services treatment with a CA
- Confirm foreign remittance/payment processor setup with your CA and bank

## How To Get Paid Users

### The right motion now

Use founder-led sales, not broad “marketing-led growth” yet.

Supercheck is still early enough that the biggest bottleneck is probably not traffic. It is:

- clear ICP
- clear wedge
- strong onboarding
- repeatable conversion from interest to paid

### Best first paid customer profile

Target teams that already feel the pain and already use adjacent tools:

- SaaS companies with small-to-mid engineering teams
- startups already using Playwright
- teams already running k6 or synthetic checks
- agencies or QA consultancies managing multiple client environments
- self-hosting-oriented companies that do not want Checkly/Datadog-style usage pricing

### Best first offer

Do not start by selling “the whole platform.”

Sell one concrete outcome:

- replace uptime + browser monitoring tools
- consolidate testing and monitoring into one self-hosted stack
- give engineering teams a status page plus monitoring in one product

### First paid-customer plan

1. Make a list of 50 target accounts.
2. Narrow to 10 accounts with the highest pain and easiest access.
3. Offer a founder-led setup call and migration help.
4. Sell an annual early-adopter plan with white-glove onboarding.
5. Turn those accounts into case studies and testimonials.

### Pricing motion

Early on, keep pricing simple:

- one hosted/self-hosted support tier
- one early-adopter annual plan
- optional paid onboarding

Avoid a complex pricing table until you know what customers actually buy for.

## Lead Sources: Who To Contact First

Not all interest signals are equal.

Use this priority order:

1. Demo users and signups
2. Inbound requests and GitHub discussions/issues from real teams
3. Warm network intros
4. High-fit target accounts using adjacent tools
5. Your own repo stargazers
6. Users who starred similar repositories

### 1. Demo users

Yes, this is the best group to contact first.

Why:

- they already know the product exists
- they already gave you a stronger signal than a GitHub star
- they are much closer to activation, onboarding, or conversion

How to use this bucket:

- segment by behavior, not just signup date
- contact users who started setup but did not finish
- contact users who ran something meaningful in the product
- contact users who returned multiple times
- offer help, onboarding, migration, or a short setup call

Best motion:

- first message should be support-oriented, not aggressive sales
- ask what they were trying to do
- offer a short call
- if they are clearly high-intent, move to a paid early-adopter conversation

Important:

- only use demo-user emails in line with your privacy policy and signup disclosures
- include an unsubscribe path for marketing emails
- keep the first message relevant and low-pressure

### 2. Your repo stargazers

Do not mass-message everyone who starred the repo.

A GitHub star is useful, but it is a weak signal:

- some users star to bookmark
- some are hobbyists, not buyers
- some are competitors or curious developers

Use stargazers mainly for:

- user research
- finding patterns in job titles, companies, and use cases
- identifying a small set of high-fit prospects for manual outreach

Good use:

- review the latest or most relevant stargazers
- pick only accounts that clearly match your ICP
- reach out outside GitHub if there is a legitimate business channel and clear fit

Bad use:

- bulk GitHub DMs
- automation against stargazer lists
- generic “thanks for starring, buy now” outreach

### 3. Users who starred similar repos

Treat this as market research first, not a direct prospect list.

This bucket is useful for:

- understanding adjacent communities
- finding companies already using Playwright, k6, self-hosted monitoring, or status-page tools
- improving messaging and comparisons

Usually do not contact these people directly just because they starred a competitor or adjacent project.

That often feels creepy and low-context.

A better approach:

- identify companies or teams behind the strongest-fit accounts
- validate whether they actually match your ICP
- reach out to the company contact with a relevant message about their workflow or tool stack
- do not mention that you scraped stars from another repo

## Practical Outreach Rules

### Contact these people

- demo users who showed real activity
- signups who got stuck at onboarding
- users who asked implementation questions
- companies visibly using Playwright, k6, or multiple monitoring tools
- people introduced through community, customers, or mutuals

### Usually do not contact these people

- every GitHub stargazer
- everyone who touched the repo once
- every user of similar tools
- random developers with no buying authority or clear pain

### Channel guidance

- Email: best for demo users, warm prospects, and direct follow-up
- LinkedIn: best for target accounts and engineering leaders
- GitHub Discussions: best for community feedback and release conversation
- GitHub DMs or issue comments for sales: usually avoid

## 30-Day Founder Outreach Plan

### Goal

Create a repeatable founder-led motion that turns product interest into calls, trials, and early paid customers.

### Week 1: Build the pipeline

- export and segment all demo users and signups
- classify them into:
  - activated
  - partially activated
  - signed up but stalled
  - clearly not a fit
- review recent stargazers and pick only high-fit profiles
- create a target-account list of 50 companies
- narrow that to 20 priority accounts
- prepare one short deck and one short demo
- define one concrete offer:
  - migration help
  - white-glove onboarding
  - early-adopter annual pricing

### Week 2: Start outreach

- send 5-10 highly personalized messages per day
- prioritize demo users first
- then contact target accounts
- publish 2 founder posts on LinkedIn
- open or pin one GitHub discussion for production-launch feedback
- book at least 5-8 calls

### Week 3: Run calls and tighten the pitch

- run discovery and demo calls yourself
- log every objection
- rewrite messaging after every 5 calls
- track:
  - reply rate
  - meeting-booked rate
  - activation rate
  - paid-conversion rate
- push the best-fit prospects toward a pilot or annual plan

### Week 4: Convert and learn

- close the strongest 1-3 accounts
- ask for a testimonial, quote, or case-study permission
- identify which segment converted best:
  - demo users
  - target outbound
  - community inbound
- cut low-signal outreach paths
- double down on the channels that create meetings and real product usage

## Outreach Cadence

Keep it short and respectful.

Suggested cadence for a good-fit account:

1. Message 1: short intro plus clear reason for reaching out
2. Follow-up 1 after 4-5 business days
3. Follow-up 2 after another 5-7 business days
4. Stop if there is no reply

Do not run long spam sequences this early.

## Sample Messages

### Demo user follow-up

```text
Subject: quick help with Supercheck?

Hi <name> —

Saw that you tried Supercheck recently. I’m one of the founders.

I wanted to ask what you were trying to set up and whether you got blocked anywhere. If helpful, I can do a quick 15-20 minute setup call and help you get Playwright, monitoring, or k6 running properly.

If it’s not relevant right now, no problem.
```

### Demo user with activation signal

```text
Subject: can help you get more value from Supercheck

Hi <name> —

Looks like you got part of the way through Supercheck and started using <feature/workflow>.

Teams usually look at us when they want to combine browser tests, uptime monitoring, load testing, and status communication without stitching multiple tools together.

If that’s the use case, happy to walk through your setup and show the fastest path to production.
```

### Target-account LinkedIn or email outreach

```text
Hi <name> —

Reaching out because your team appears to be doing browser automation / synthetic monitoring / load testing, and we built Supercheck for teams that want those workflows in one self-hosted platform.

The strongest fit so far is for teams trying to reduce tool sprawl or avoid usage-based monitoring pricing.

If useful, I can show a short demo and be direct about where it fits and where it does not.
```

### Stargazer outreach rule

If you contact a stargazer at all, do not lead with “I saw you starred our repo.”

Lead with the problem or workflow, not the star.

## Measurement

Track outreach in a simple spreadsheet or CRM.

Use these columns:

- source
- company
- contact
- ICP fit
- current tool stack
- first message date
- replies
- meeting booked
- product activated
- paid
- annual value
- key objection

### Judge channel quality by:

- reply rate
- meeting-booked rate
- activation after call
- paid conversion
- revenue, not vanity engagement

## Recommendation On Stars And Similar Repos

### Best answer

- Yes: reach out to demo users
- Sometimes: reach out to a small number of high-fit stargazers
- Usually no: mass outreach to all stargazers
- Usually no: direct outreach to users only because they starred similar repos

### Why

Demo users are intent.

Stargazers are curiosity.

Competitor or adjacent-repo stargazers are mostly research data unless you can tie them to a real company need.

## Compliance Note

This is not legal advice, but if you email prospects or demo users, build the motion as if it may be reviewed later:

- identify yourself clearly
- do not mislead in subject lines or sender identity
- provide an opt-out path for marketing emails
- respect applicable privacy and anti-spam rules in the countries you sell into

For platform behavior, GitHub publicly shows stargazers, but GitHub’s policies also prohibit spam, bulk promotion, and disruptive activity. Use stargazer lists carefully and manually, not as a bulk-growth hack.

## Should You Hire A Marketing Person Now?

### Short answer

No full-time marketing hire yet.

### Why

At this stage, the founder should still own:

- product story
- ICP learning
- positioning
- sales calls
- objection handling
- early pricing

If you hire marketing too early, they will be forced to scale a message that has not fully stabilized yet.

### Better near-term option

If you want help now, hire one of these instead:

- a strong freelance content/distribution operator
- a part-time GTM advisor
- a technical writer/content marketer for case studies, tutorials, and comparison pages

Do this before hiring a full-time head of marketing.

### Good trigger for the first marketing hire

Consider a full-time GTM or marketing hire only after you have:

- a clear ICP
- a repeatable conversion path
- at least several paid customers
- proof that one message consistently gets meetings and closes

## Should You Start LinkedIn Outreach?

### Yes, but not spammy mass outreach

LinkedIn makes sense for Supercheck because this is a B2B technical product and the relevant buyers are on LinkedIn.

But the right approach is:

- targeted founder outreach
- useful content
- small, personalized account lists
- follow-up tied to a real pain point

Not:

- generic pitch spam
- outsourced bulk DMs
- blasting everyone who looks technical

### Recommended LinkedIn motion

1. Publish founder posts 2-3 times per week.
2. Share concrete product content:
   - migration examples
   - reliability checklists
   - “how we run Playwright + k6 + uptime in one stack”
   - production hardening lessons
3. Build a list of engineering leaders, QA leads, SRE leads, and devtools-friendly founders.
4. Send short personalized notes based on real fit.
5. Offer a specific next step:
   - 20-minute demo
   - migration walkthrough
   - early-adopter onboarding

### Simple outreach template

```text
Hi <name> — noticed your team uses <tool/workflow>.

We built Supercheck to combine Playwright testing, k6 load testing, uptime monitoring, and status pages in one self-hosted platform.

If reducing tool sprawl or usage-based monitoring cost is relevant, happy to show a short demo or walk through where it fits and where it doesn’t.
```

## Recommended 30-Day Plan

### Days 1-7

- Fix release blockers
- Ship a stable tag
- tighten onboarding
- create a short demo flow
- prepare a one-page pricing and packaging draft

### Days 8-14

- Reach out to 20 hand-picked target accounts
- run founder-led demos
- close 2-5 design partner conversations
- collect objections and rewrite messaging

### Days 15-21

- convert the strongest design partners into paid annual customers
- publish one detailed case study or migration writeup
- post launch content to GitHub, LinkedIn, and one community per week

### Days 22-30

- decide whether to expand regions
- tighten support and onboarding based on real usage
- publish a public “production ready” release announcement only after the stable cohort is happy

## Repo Follow-Ups

These repository-level follow-ups would improve launch readiness:

- add a public release checklist
- add a documented support and response policy
- decide whether external contributions are accepted or clearly position the project as vendor-led open source
- replace visible canary references in product UI where stable launch perception matters

## Sources

Official and current references used for the India incorporation process and GTM guidance:

- MCA SPICe+ V3 FAQs: https://www.mca.gov.in/content/dam/mca/pdf/SPICEplus-and-linked-filings-FAQs-V3-20230122.pdf
- MCA SPICe+ overview / key features: https://www.mca.gov.in/Ministry/pdf/SPICe%2Band_linked_filings_FAQs_V3_13%20Jan_2022_updated.pdf
- MCA SPICe+ process explainer: https://www.mca.gov.in/content/dam/mca/videos/audio_pdfs/Video_SPICeplus_AudioText.pdf
- CCA on Digital Signature Certificates: https://cca.gov.in/eSign.html
- CCA service information: https://cca.gov.in/avail_service.html
- GitHub Discussions best practices: https://docs.github.com/en/discussions/guides/best-practices-for-community-conversations-on-github
- LinkedIn lead generation guidance: https://business.linkedin.com/advertise/resources/lead-generation
- First Round on founder-led sales: https://review.firstround.com/0-5m-how-to-nail-founder-led-sales/
- First Round on early-stage GTM process and forecasting: https://review.firstround.com/the-most-common-go-to-market-questions-from-founders/

## Final Recommendation

Register the company before broad paid rollout.

Do not hire a full-time marketer yet.

Do start targeted LinkedIn outreach now, but do it founder-led and account-based.

The fastest path to paid users is:

- fix production blockers
- sharpen one wedge
- run founder-led demos
- close a few design partners
- turn those into annual paid customers and case studies
