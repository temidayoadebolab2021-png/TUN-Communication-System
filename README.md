# PnW Recruitment Bot — Phase 1 (Mail Bridge)

This is **Phase 1** of your bot. It can:
- Send in-game mail from Discord (`/mail send`)
- Log every mail sent into a dedicated thread per recruit
- Let staff reply to recruits from inside that thread (`/reply`)
- Show full mail history for a nation (`/mail history`)
- List all available commands at any time (`/help`) — this list always stays accurate automatically, even after future upgrades add new commands

It does NOT yet do auto-recruiting, bulk mailing, or the CRM stuff —
that's Phase 2+. This phase is the foundation everything else plugs into.

---

## STEP 1 — Install Node.js (one-time, only if you don't have it)

1. Go to https://nodejs.org
2. Download the "LTS" version (the recommended one)
3. Install it like any normal program (click Next, Next, Finish)
4. To check it worked: open a terminal (in VS Code: top menu → Terminal → New Terminal)
   and type:
   ```
   node -v
   ```
   You should see something like `v20.11.0`. If you see an error, restart your computer and try again.

---

## STEP 2 — Open this folder in VS Code

1. Unzip the file you downloaded.
2. Open VS Code.
3. File → Open Folder → select the unzipped `pnw-bot` folder.

---

## STEP 3 — Install the bot's dependencies

In VS Code's terminal (Terminal → New Terminal), type:

```
npm install
```

This downloads the small code libraries the bot needs (just Discord.js and a
couple of helpers) into a `node_modules` folder. This can take a minute.

> **Note:** This bot stores its data in a plain JSON file (`data/bot.json`),
> not a real database, so there's nothing extra to install or compile — no
> Visual Studio, no build tools, nothing. `npm install` should "just work"
> on any Windows/Mac/Linux machine.

---

## STEP 4 — Create your `.env` file (your secret settings)

1. In VS Code's file explorer (left side), find the file called `.env.example`
2. Right-click it → "Copy" → then right-click the folder → "Paste"
3. Rename the copy to exactly: `.env` (no extension after it)
4. Open `.env` and fill in each value:

| Setting | Where to find it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → Your App → "Bot" tab → click "Reset Token" or "Copy" |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → Your App → "General Information" → "Application ID" |
| `DISCORD_GUILD_ID` | In Discord: enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click your server icon → "Copy Server ID" |
| `PNW_API_KEY` | politicsandwar.com → Account → API Key. Click **"Allow Access"** on that key to turn on "Whitelisted Access" — required for sending mail (lookups work without it) |
| `MAIL_LOG_CHANNEL_ID` | In Discord: right-click the text channel you want mail logs posted in → "Copy Channel ID" |

⚠️ **Never share your `.env` file with anyone or post it publicly.** It contains your bot's password essentially.

---

## STEP 5 — Invite your bot to your server

If you haven't already:
1. Discord Developer Portal → Your App → "OAuth2" tab → "URL Generator"
2. Check the box: `bot`
3. Under "Bot Permissions" check: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`, `View Channels`, `Use Slash Commands`
4. Copy the generated URL at the bottom, paste it into your browser, choose your server, click Authorize.

---

## STEP 6 — Register the slash commands

In VS Code's terminal:

```
node src/deployCommands.js
```

You should see `✅ Slash commands registered successfully.`
This step only needs to be re-run if you add or change commands later.

---

## STEP 7 — Start the bot

```
node src/index.js
```

You should see:
```
✅ Logged in as YourBotName#1234
✅ Bot is online in 1 server(s).
```

Leave this terminal window running — closing it turns the bot off.
(Later, when we move to Railway, it'll run 24/7 without your computer being on.)

---

## STEP 8 — Try it out in Discord

In the channel you set as `MAIL_LOG_CHANNEL_ID`, type:

```
/mail send nation:12345 subject:"Join Union of Nations" message:"Hello commander, we'd love to have you!"
```

You can put any of these in the `nation` field — the bot figures out which one you mean:
- A nation ID: `12345`
- A nation name (any capitalization): `arrow kingdom`
- A full profile link: `https://politicsandwar.com/nation/id=12345`

The bot will:
1. Send the actual in-game mail via the PnW API
2. Create a thread like `recruit-12345-nation-name`
3. Post the log inside that thread

To reply later, **go into that thread** and type:
```
/reply message:"Thanks for your interest!"
```

To see the full conversation:
```
/mail history nation:12345
```

---

## Troubleshooting

- **"Missing or unfilled setting"** → you forgot to fill in a value in `.env`, or didn't rename it from `.env.example`
- **Mail fails to send / permissions error** → go to politicsandwar.com → Account → API Key, and click "Allow Access" to turn ON Whitelisted Access for your key
- **Slash commands don't show up in Discord** → re-run `node src/deployCommands.js`, then fully close and reopen Discord
- **"Cannot find module..."** → run `npm install` again
- **npm install errors about "node-gyp", "Visual Studio", or "EPERM"** → this was from an old version of this bot that used a database requiring compiling. Make sure you're using the latest zip I gave you (no `better-sqlite3` in package.json) — delete your `node_modules` folder and `package-lock.json`, then run `npm install` again.

---

## What's next (Phase 2)

Once this is working for you, tell me and I'll build:
- Automatic detection + mailing of brand-new nations
- Rate-limiting / duplicate-mail protection (Module 13)
- Randomized recruitment templates (Module 2)

Then later phases add bulk recruiting, the CRM, blacklist, dashboards, etc.

---

# PHASE 2 — Automatic Recruitment

This phase adds:
- **Background scanner** that checks every 5 minutes for brand-new, unaligned nations
- **Recruitment templates** you write and manage from Discord
- **Random template rotation** — different new nations get different wording, so it doesn't look like spam
- **Duplicate protection** — the bot remembers every nation it has ever seen, so it will never auto-mail the same one twice
- **A safety cap** — at most 15 mails per 5-minute scan, with a 2-second pause between each, so PnW's servers (and your account) never get hammered

### New setup steps for Phase 2

1. Replace your project files with the new zip (or copy over: `src/database.js`, `src/pnwApi.js`, `src/index.js`, `package.json`, and add the new files `src/commands/recruit.js` and `src/scheduler/newNationScanner.js`)
2. Run `npm install` again (this adds the `node-cron` scheduling library)
3. Run `node src/deployCommands.js` again (registers the new `/recruit` command)
4. Start the bot: `node src/index.js`

### How to use it

**Step 1 — Create at least one template:**
```
/recruit template create id:friendly1 subject:"Join Union of Nations!" body:"Hi {leader_name} of {nation_name}, we'd love to have you join our alliance!"
```
You can create several — the bot picks one at random each time, so use `{nation_name}` and `{leader_name}` as placeholders; the bot fills them in automatically.

**Step 2 — Check your templates:**
```
/recruit template list
```

**Step 3 — Turn auto-recruit ON:**
```
/recruit auto state:on
```

**Step 4 — Check status anytime:**
```
/recruit status
```

That's it. Every 5 minutes, the bot checks for new nations with no alliance, and mails each one a random template — logging everything into that nation's thread, just like a manual `/mail send` would.

**To turn it off:**
```
/recruit auto state:off
```

**To delete a template:**
```
/recruit template delete id:friendly1
```

### Important notes

- ⚠️ **The very first scan after turning auto-recruit on will mark roughly the 50 most recent unaligned nations as "known" — but it will only mail them if you had auto-recruit ON *before* that scan ran.** If you want to test safely, create a template, turn auto-recruit on, then just watch your Discord log channel for the next 5-10 minutes.
- The scanner only looks at nations with **no alliance** (`alliance_id` of 0) — nations already in an alliance are skipped automatically.
- If you ever stop the bot for a long time, the next scan will only process new nations since you turned auto-recruit off — it won't dump a huge backlog of recruits all at once (capped at 15 per run).

### What's next (Phase 3)

Tell me when this is working and I'll build:
- Bulk recruiting commands (mail everyone matching a filter, e.g. score/city range)
- Recruitment pipeline stages (New → Interested → Joined, etc.)
- Recruit CRM profiles with notes and staff assignment

---

# PHASE 3 — Bulk Recruiting, Pipeline Tracking, CRM & Blacklist

This phase adds:
- **`/blacklist add/remove/list`** — nations the bot should never recruit (hostile players, trolls, spies)
- **`/recruit stage`** — track each recruit through a pipeline: New → Interested → Interviewing → Invited → Joined → Rejected → Blacklisted
- **`/recruit profile`** — a full CRM-style snapshot of any recruit: score, cities, stage, assigned staff, mail count, notes
- **`/recruit assign`** — assign a recruit to a specific staff member
- **`/recruit note`** — save free-text notes on a recruit
- **`/recruit stats`** — a dashboard of total mails sent, recruits by stage, and conversion rate
- **`/recruit bulk`** — mail many unaligned nations at once, filtered by score/city range, with a **dry-run by default** so you see exactly what would happen before anything is sent

### New setup steps for Phase 3

1. Replace your project files with the new zip (or unzip fresh, as before)
2. Run `npm install` (no new packages this time, but safe to run anyway)
3. Run `node src/deployCommands.js` (registers the new `/blacklist` command and the new `/recruit` subcommands)
4. Start the bot: `node src/index.js`

### How to use it

**Track a recruit's progress:**
```
/recruit stage nation:arrow kingdom stage:Interested
```

**See everything about a recruit:**
```
/recruit profile nation:arrow kingdom
```

**Assign a recruit to a staff member:**
```
/recruit assign nation:arrow kingdom staff:@Joe
```

**Add a note:**
```
/recruit note nation:arrow kingdom text:"Said they might join after talking to their alliance"
```

**Check your dashboard:**
```
/recruit stats
```

**Blacklist a troublesome nation:**
```
/blacklist add nation:troll kingdom reason:"Spammed hostile messages"
```

**Bulk recruit (the big one) — always test with a dry-run first:**
```
/recruit bulk score-min:50 score-max:300 cities-min:1 cities-max:10
```
This shows you how many nations match **without sending anything**. When you're happy with the numbers, re-run the exact same command with `confirm:true` added:
```
/recruit bulk score-min:50 score-max:300 cities-min:1 cities-max:10 confirm:true
```

### Built-in safety limits (Module 13)

- **Max 30 mails per bulk-send command** — if more nations match, the rest are simply left for your next run, so you can never accidentally blast hundreds of nations at once
- **2-second pause between each mail** sent during a bulk run
- **7-day cooldown** — any nation mailed (manually, automatically, or in bulk) within the last 7 days is automatically skipped in future bulk runs
- **Blacklisted nations are always skipped** in bulk runs, and manual `/mail send` will warn you and refuse unless you remove them from the blacklist first

### A technical honesty note

PnW doesn't publicly document the exact filter arguments their API accepts for things like score/city ranges, so `/recruit bulk` works by fetching pages of nations (sorted by score) and filtering them in our own code — using only the data fields we've already confirmed work reliably (`score`, `num_cities`, `alliance_id`). This is slightly slower than a server-side filter would be, but far more reliable, since it doesn't depend on guessing undocumented API behavior.

### What's next (Phase 4)

Once this is solid, tell me and I can add things like: cooldown-aware automatic follow-up campaigns (Day 3 / Day 7 / Day 14 reminders), A/B testing between templates to see which converts best, and a join-attribution system to track which recruiter/campaign brought in each new member.

---

# PHASE 4 — Follow-Up Campaigns, A/B Testing & Join Attribution

This phase adds:
- **Automatic follow-ups** at ~3, ~7, and ~14 days after first contact, but only to recruits still sitting at the "New" stage (our best proxy for "hasn't replied," since PnW's API has no inbox-reading capability)
- **Template types** — templates are now tagged `initial`, `followup1`, `followup2`, or `followup3`, so the bot knows which message to send at which point
- **A/B testing report** (`/recruit template stats`) — shows how many recruits each template first-contacted, and how many of those eventually joined
- **Join attribution** (`/recruit attribution`) — for every nation currently at "Joined" stage, shows exactly which template and which sender (staff member or the automated system) first reached them

### New setup steps for Phase 4

1. Replace your project files with the new zip
2. `npm install` (no new packages needed, but safe to run)
3. `node src/deployCommands.js` (registers the new `template stats` and `attribution` subcommands, plus the new `type` option on `template create`)
4. `node src/index.js`

### How to use it

**Create a follow-up template** (same command as before, with a new `type` option):
```
/recruit template create id:gentle-nudge type:followup1 subject:"Still there?" body:"Hi {leader_name}, just checking in - still interested in {nation_name} joining us?"
```

Without follow-up templates created, the bot simply won't send any follow-ups (it never sends a generic fallback) - so this is entirely opt-in. Your existing `initial`-type templates from Phase 2/3 keep working exactly as before with no changes needed.

**See which templates are converting best:**
```
/recruit template stats
```

**See who brought in your recent joins:**
```
/recruit attribution
```
(Remember to actually move recruits to "Joined" with `/recruit stage` as they join your alliance in-game — this report is only as accurate as your stage-tracking.)

### Important honesty notes

- **"No reply" is inferred, not detected.** Since PnW's API can't read your inbox, the bot treats "still at stage New" as a stand-in for "hasn't responded yet." If staff manually move a recruit to **any** other stage (Interested, Interviewing, Invited, Rejected, even just adding them somewhere), follow-ups stop for that recruit. Make a habit of updating stages as you talk to people, or the bot will keep following up with someone you're already in conversation with.
- **The scan runs once daily**, not continuously, so a recruit who crosses the 3-day mark might get their follow-up anywhere within that day's check rather than the exact moment they hit 72 hours.
- Follow-ups respect the blacklist, just like everything else.

### What's next (Phase 5 and beyond)

At this point, all the "high-end" features from the original spec (Module 16) are covered except multi-alliance support and recruit scoring. Let me know if you want either of those, or if you'd like to revisit/polish anything from earlier phases instead (e.g. the staff-assignment alert system, or a proper applicant-detection module for when someone applies directly to your alliance).

---

# PHASE 5 — Faster, More Accurate Bulk Search

This phase doesn't add new commands — it's an under-the-hood upgrade to `/recruit bulk`.

### What changed and why

While researching the next phase, I found PnW's actual published GraphQL schema. Two important things came out of that:

1. **`/recruit bulk` is now faster and more accurate.** Previously, it fetched large batches of nations and filtered by score/cities in our own code. PnW's API actually supports real server-side filters for this (`min_score`, `max_score`, `min_cities`, `max_cities`), so the bot now asks PnW's servers to do the filtering directly - fewer requests, faster results.
2. **New option: `exclude-vacation-mode`** (defaults to `true`). Nations in vacation mode can't be recruited anyway, so they're now skipped automatically unless you explicitly turn this off.
3. **Safety net included:** if PnW's servers ever reject these filter arguments (their documentation has been wrong before, twice, in this very project), the bot automatically falls back to the old, slower-but-proven method instead of breaking. You'd never see an error from this - it just quietly falls back and keeps working.

### An honest, important limitation I confirmed this round

**Module 6 from the original spec ("auto-detection of alliance applicants") cannot be built.** I found and read PnW's actual schema for the `Alliance` type, and it has no field anywhere for pending applicants - not for your alliance, not for any alliance. This isn't a gap in the bot; it's data PnW simply doesn't expose through their API at all. If you want to react to new applicants, that will always require someone manually checking your alliance's applicant list in-game and acting on it - there's no way around that with the tools PnW provides.

### Setup steps

1. Replace `src/pnwApi.js` and `src/commands/recruit.js` with the new versions (or unzip fresh, as always)
2. `npm install` (no new packages)
3. `node src/deployCommands.js` (registers the new `exclude-vacation-mode` option)
4. `node src/index.js`

No changes to how you actually use `/recruit bulk` - same command, same dry-run-first workflow, just faster and slightly smarter by default now.

---

# PHASE 6 — Recruit Scoring System

This adds a 0-100 quality score to every recruit, based on activity, city count, infrastructure, nation age, and war activity - so you can triage candidates instead of treating every unaligned nation the same.

### New setup steps

1. Replace your project files with the new zip
2. `npm install` (no new packages)
3. `node src/deployCommands.js` (registers the new `/recruit score` subcommand)
4. `node src/index.js`

### How to use it

**Check one nation's score:**
```
/recruit score nation:arrow kingdom
```
Shows the total score, tier (High/Medium/Low), and a breakdown of exactly why it scored that way.

**See it baked into a profile:**
```
/recruit profile nation:arrow kingdom
```
Now includes a "Recruit Quality" field alongside everything else.

**Bulk sends now prioritize automatically.** When you run `/recruit bulk`, candidates are scored and sorted best-first *before* the 30-per-run safety cap is applied - so if there are 200 eligible nations, the 30 highest-scoring ones get mailed, not just the first 30 found. The dry-run output now also shows the average quality score across all eligible nations, so you get a feel for the batch before sending anything.

### How scoring works (so you can trust or adjust it)

| Factor | Max points | Logic |
|---|---|---|
| Activity | 35 | Active in the last 24h scores highest; drops off after that |
| Cities | 25 | More cities = more invested player (caps at 15 cities) |
| Infrastructure | 20 | Higher average infrastructure per city = more developed |
| Nation age | 12 | 2-180 days old scores highest (established but still searching); brand new or very old scores lower |
| War activity | 8 | Any current war involvement suggests an engaged, active player |

**Important honesty note:** this is a heuristic I designed based on reasonable assumptions about what makes a "good" recruit, not something PnW or anyone else validated. It's meant to help you sort a long list faster, not to replace your own judgment about a specific nation. If after using it for a while the priorities feel wrong (e.g. you think war activity shouldn't matter, or city count should be weighted higher), tell me and I can adjust the weights - they're just numbers in one function, easy to retune.

---

# PHASE 7 — Merged in Your Mailing/Announcement Bot

Your separate Discord mailing bot's features are now part of this bot. New commands:

- **`/dm user`** — DM a single person, with an optional image attachment
- **`/dm role`** — mass-DM everyone with a given role, showing live progress and respecting Administrator-only permission
- **`/announce`** — post a message (with optional image) to any channel
- **`/cancel`** — stop an in-progress mass DM partway through

### Setup steps (read carefully - one extra step this time)

1. Unzip the new project files as usual (or copy over: `src/index.js`, and add the new files `src/commands/dm.js`, `src/commands/announce.js`, `src/commands/cancel.js`, `src/state/massDm.js`)
2. **New Discord setting required:** go to the [Discord Developer Portal](https://discord.com/developers/applications) -> your bot application -> **Bot** tab -> scroll to **"Privileged Gateway Intents"** -> turn ON **"Server Members Intent"**. This is required for `/dm role` to find everyone who has a given role. Without this toggle, the bot will fail to start or `/dm role` won't work.
3. `npm install` (no new packages needed)
4. `node src/deployCommands.js` (registers `/dm`, `/announce`, `/cancel`)
5. `node src/index.js`
6. Push to GitHub so Railway picks up the update - and don't forget to enable that same intent toggle; it's a Discord-side setting tied to your bot application, not something Railway needs configured separately.

### What I did NOT carry over, and why

- Your old bot used its own separate `.env` values (`TOKEN`, `CLIENT_ID`, `GUILD_ID`). Since we're merging into **one bot identity** (this PnW bot, already live on Railway), these commands now use your existing `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` - you don't need to add anything new to `.env`.
- If your old mailing bot was a **separate Discord application** (different bot user in your server), you can now remove/kick that old bot from your server once you confirm `/dm`, `/announce`, and `/cancel` work under this bot instead - having both running would just be redundant.
- I kept the exact same permission model (Administrator-only) and behavior (1.2 second delay between DMs, progress updates every 5 members, cancellable mid-run) as your original bot - nothing about how these commands work was changed, only where the code lives.

### Verified before delivery

I tested that all 8 commands (the 5 original PnW commands plus these 3 new ones) load without errors, and confirmed `/help` automatically picked up the 3 new commands with zero manual edits to `help.js` - proving the self-updating design from earlier is working as intended.

---

# PHASE 8 — Personal API Keys & Recruiter Role Permissions

This phase lets individual staff members send recruitment mail from THEIR OWN nation, instead of everything going out under yours - plus an optional way to restrict who can send recruitment mail at all.

### New commands

- **`/apikey set key:<your key>`** — register your own PnW API key (privately - only you see the confirmation). The bot tests the key actually works before saving it.
- **`/apikey remove`** — delete your stored key
- **`/apikey status`** — check if you have a key registered (never displays the key itself)
- **`/config recruiter-role set/clear/status`** — Admin-only. Optionally restrict `/mail send` and `/recruit bulk` to Administrators plus one specific role.

### How it works

Once a staff member runs `/apikey set`, every `/mail send` or `/recruit bulk` THEY personally run will send mail from THEIR nation instead of the shared one in `.env`. Staff who haven't registered a key keep using the shared alliance key exactly as before - nothing changes for them. The bot tells you which one was used every time ("from your own nation" vs "from the alliance's shared nation"), so there's never ambiguity about who a recruit's mail actually came from.

**Auto-recruit and follow-up scans always use the shared key**, regardless of who set up the bot - they're automated, not run by a specific person, so there's no "personal" identity to use for them.

### Setup steps

1. Unzip the new project files, add the new files: `src/commands/apikey.js`, `src/commands/config.js`, `src/utils/permissions.js`
2. `npm install` (no new packages)
3. `node src/deployCommands.js` (registers `/apikey` and `/config`)
4. `node src/index.js`

### Setting up role-based permission (optional)

By default, anyone can still use `/mail send` and `/recruit bulk` - same as before this feature existed. If you want to restrict it to a "Recruiter" role:
```
/config recruiter-role set role:@Recruiter
```
To remove the restriction later:
```
/config recruiter-role clear
```

### Important honesty notes - please read before relying on this

- **Where keys are stored:** personal API keys are saved in the bot's local data file (`data/bot.json`), in plain text - not specially encrypted. This file is already excluded from your GitHub repo (so it never becomes public), but anyone with direct access to your Railway hosting dashboard could technically open that file and read the keys inside it. This is the same level of protection your bot's other secrets (like your own `.env`) already get - not bank-grade encryption, just "not exposed publicly." If a staff member isn't comfortable with that level of protection, they should not register their key, and can keep using the shared one instead.
- **Key validation is real but limited.** When someone runs `/apikey set`, the bot actually tests the key against PnW's API before saving it - so typos and dead keys get caught immediately. However, this test only confirms the key can read data; it can't 100% guarantee the key is allowed to send mail, since PnW's send-message system is a separate endpoint with its own rules. If sending fails despite a "valid" key, that's something to take up with PnW directly, not a bug in this check.
- **If a staff member leaves your alliance or shouldn't have access anymore,** an admin can remove their key directly with `/apikey remove-for user:@someone` - no need to wait for them to do it themselves.

---

# PHASE 9 — Alliance-Departure Recruiting (with honest limitations)

This adds Module 3 from the original spec: automatically recruiting nations that have left an alliance, not just brand-new signups.

### Read this before turning it on - how it actually works

PnW's API has **no field anywhere that records alliance history** - there's no way to ask "who left an alliance yesterday." So this works by inference instead: once a day, the bot checks every established (3+ days old), unaligned nation, and compares that list to what it saw the day before. Anyone newly appearing on the unaligned list is assumed to have just left (or been kicked from, or had disbanded) an alliance - that's the only way an established nation becomes unaligned.

**What this means in practice:**
- It cannot tell you *why* someone left
- It cannot catch someone who left and immediately joined a different alliance before the next daily check (they'd never appear as unaligned in our data at all)
- **The very first time this scanner ever runs, it does nothing but quietly record who's currently unaligned** - no mail gets sent on that first run, because every existing unaligned nation would otherwise look like a "new departure." Only runs after that first one can detect anything real.

If this kind of inference-based guessing isn't precise enough for your alliance's standards, this feature is easy to leave permanently off (it respects the same `autoRecruitEnabled` toggle as new-nation recruiting).

### Setup steps

1. Unzip the new project files, add the new file `src/scheduler/allianceExitScanner.js`
2. `npm install` (no new packages)
3. `node src/deployCommands.js` (registers the new `departure` template type option)
4. `node src/index.js`

### How to use it

It runs automatically once a day (10:00 AM server time), using your existing `autoRecruitEnabled` setting - if that's already on from Phase 2, this starts working immediately (after its one silent backfill run). No new command to turn it on separately.

**Optional: write a departure-specific message** (otherwise it just reuses your `initial` template pool):
```
/recruit template create id:welcome-back type:departure subject:"Looking for a new home?" body:"Hi {leader_name}, we noticed {nation_name} is currently unaligned - would Union of Nations be a good fit for you?"
```

Mail sent this way is logged exactly like everything else - same threads, same `/mail history`, same cooldown and blacklist protection, same attribution tracking for `/recruit attribution`.
