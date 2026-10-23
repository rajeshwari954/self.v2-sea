# self.v2 log (v3)

The same app as before, with a new look and new screens. It still saves straight into Notion, only into the databases under your **self.v2** page, behind your passcode.

```
public/                    the app screen
  index.html               all five screens
  manifest.webmanifest     home-screen install
  sw.js                    keeps the app shell on the device
  icons/                   copy your three icon files in (see the note inside)
netlify/functions/api.mjs  the server function: holds the Notion key, does the reading and saving
netlify.toml               unchanged
```

## What's new

- **Today:** grouped tiles (Mind, Body, Supplements) with streaks, plus Vit B12, Vit D3, Magnesium and Herbal tea (tap 0 → 1 → 2). Day type and Location for the day. Calm and Focus. Add-to-log buttons for Sleep, Meal, Workout, Speech, Reading and Hobby.
- **Plan:** a colour-coded timeline of blocks, events and timed to-dos (events solid, blocks tinted, to-dos dashed), with start, finish and minutes that stay in sync. All-day and multi-day events (like a trip) show on every day they cover. Planned vs done time. A to-do list with reminder times.
- **Calendar:** month grid with gym, supplement and event dots and vacation days tinted. Tap a day to open it.
- **Progress:** week and month dashboards: ticks per day, sleep, calories, workouts, speech, calm and focus averages, habit grids and completion, and spending.
- **Money:** month-end expense log with category totals.
- **Workout** no longer asks for sets, reps or weight. It takes the exercise and one or more sessions (Lower, Upper, Skipped, Plyometrics, Strength training, Cardio, Walk). Lower, Upper, Strength training or Plyometrics also tick **Gym**.
- **Speech training** is the new name in the app for the Talk Log. Nothing was renamed in Notion.
- Layout for iPhone (dock at the bottom), iPad (two columns, pop-up forms) and Mac (sidebar, keys 1–5, Esc closes a form). Ivory light theme and a matching dark theme. It follows your device by default; **Theme** at the bottom of any screen cycles Auto → Light → Dark.

## Before you deploy

1. **Don't overwrite the live app yet.** Put this folder in a **new** GitHub repo (or a new branch) and create a **new Netlify site** from it, so the old app keeps working while you try this one.
2. Copy your three icons into `public/icons/`.
3. In the new Netlify site, add the same two variables as before: `NOTION_TOKEN` and `APP_PASSCODE`, then redeploy.
4. The Notion connection needs no change: it already has access to the self.v2 page, and the new **To-dos**, **Expenses** and **Time Blocks** databases sit inside it.

Note: the **old app can't save a Lift right now**, because the Strength Log's Session field now allows several choices and the old code sends one. This version fixes that.

## Using it

- Tap a tile to tick it. **Abs** and **Herbal tea** cycle 0 → 1 → 2; two counts as done.
- **Today / Yesterday** switches the day. From the Calendar, tap any date to log or look back at that day. Between midnight and 4 am it starts on yesterday.
- **Plan → Add to plan** adds a Block, Event or To-do. A finish earlier than the start means it runs past midnight.
- **×** on a to-do, block or expense moves it to Notion's Trash, where you can restore it.
- **Theme** (bottom of any screen) switches between Auto (follows your device), Light and Dark, and remembers the choice on that device.
- **Lock** forgets the passcode on that device.

## When something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| "That passcode isn't right." | Doesn't match `APP_PASSCODE` | Re-enter it, or check the variable in Netlify |
| "Notion rejected the key." | `NOTION_TOKEN` is wrong or was regenerated | Paste the current secret into Netlify, then redeploy |
| "Notion can't see your logs." | The connection isn't on the self.v2 page | On self.v2: ••• → Connections → add your connection |
| "Notion rejected this: …" | A field or option was renamed or deleted in Notion | Rename it back, or ask Claude to update `api.mjs` |
| "Couldn't confirm that save." | The connection dropped mid-save | Check the list (it refreshes itself) before adding it again |
| Sleep or calories show "—" on Progress | The day's rollup in Notion isn't a plain total | Tell Claude; it's a small change in `api.mjs` |

Adding new fields or options in Notion is fine. Renaming or removing these breaks saving for that log:

- **Daily Check-in:** Day, Date, Meditation, News update, 5 pages, Riyaaz, Gym, Vit B12, Vit D3, Magnesium, Ab workouts, Herbal tea, Calm, Focus, Day type, Location (and the rollups Sleep hours, Total calories, Lifts logged, Talks done, Pages / min read, Hobby minutes for Progress)
- **Sleep Log:** Night, Sleep, Quality (1-5), Woke up feeling
- **Food Log:** Item, Meal, Date, Calories, Protein (g), Fat (g), Carbs (g)
- **Strength Log:** Exercise, Session (multi-select), Date, Notes
- **Talk Log:** Topic, Date, Talk (min), Prep (min), Self-rating (1-5), Notes
- **Reading Log:** Title, Type, Area, Date, Pages / Minutes, Takeaway
- **Hobby Log:** What I did, Hobby, Date, Minutes, Notes
- **To-dos:** Task, Date, Done, Category, Notes
- **Time Blocks:** Block, Kind, Category, Planned, Actual, Status, Notes
- **Expenses:** Item, Date, Amount, Category, Notes
- The **Check-in day** link on every log, to-do and block.

## Safety

- The Notion key lives only in Netlify's settings. The app screen never sees it.
- The site link is public; the passcode is what stops anyone else writing to your Notion.
- Each edit or removal first checks the item really belongs to your To-dos, Time Blocks or Expenses, so the app can't touch any other page.
- To cut access completely, remove the connection from the self.v2 page in Notion.
