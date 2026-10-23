// self.v2 log (v3) — server function.
// Holds the Notion key, checks the passcode, and reads/writes the self.v2 databases.
// GET  /api/ping | today?day= | range?from=&to= | expenses?from=&to=
// POST /api/habit | daymeta | log | todo | block | expense | done | remove

import { timingSafeEqual } from 'node:crypto';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const TZ = '+05:30';

const DB = {
  checkin: '70c16a3cd485413294d5ea0a7cfbe8ac',
  sleep: 'd96d4a7c8f874079b5a76071e8919b3f',
  meal: '1da5f2a3686745ae90a05fae39f5e790',
  lift: '5e7b704dcf13493aa43e3389acc2224a',
  talk: '620e44e6ac1143b184752f2e14da1aa7',
  reading: 'f9b2b4f8cb2b4aa7b09e64e6ef1cc294',
  hobby: 'e3c1de78ea5a4941a4998ef6a32bc261',
  todo: '4d08dac1822547eea0ded0a34dbce6f5',
  block: '153f54662fb94705ac467214dc8cac70',
  expense: '1dc5bb55d9bd400793812e0714668757'
};

const HABITS = ['Meditation', 'News update', '5 pages', 'Riyaaz', 'Gym', 'Vit B12', 'Vit D3', 'Magnesium'];
const NUMBERS = { 'Ab workouts': [0, 10], 'Herbal tea': [0, 10], 'Calm': [1, 5], 'Focus': [1, 5] };
const DAY_TYPES = ['Normal', 'Vacation', 'Travel day', 'Sick', 'Off'];
const MEALS = ['Breakfast', 'Brunch', 'Lunch', 'Snack', 'Dinner'];
const SESSIONS = ['Lower', 'Upper', 'Skipped', 'Plyometrics', 'Strength training', 'Cardio', 'Walk'];
const GYM_SESSIONS = ['Lower', 'Upper', 'Strength training', 'Plyometrics'];
const FEELINGS = ['Rested', 'Okay', 'Tired'];
const CATEGORIES = ['Range', 'Athlete', 'Quiet Mind', 'Work', 'Nutrition', 'Personal', 'Travel'];
const KINDS = ['Block', 'Event'];
const EXPENSE_CATS = ['Rent', 'Food', 'Transport', 'Health', 'Subscriptions', 'Shopping', 'Travel', 'Other'];

// ---------- helpers ----------
class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayParts = (day) => { const d = new Date(day + 'T00:00:00Z'); return { wd: WD[d.getUTCDay()], n: d.getUTCDate(), mo: MO[d.getUTCMonth()] }; };
const dayTitle = (day) => { const p = dayParts(day); return `${p.wd}, ${p.n} ${p.mo}`; };
const hhmm = (iso) => (typeof iso === 'string' && iso.length > 10 ? iso.slice(11, 16) : '');
const mins = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const plain = (id) => String(id || '').replace(/-/g, '').toLowerCase();

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optNum = (v, min, max) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n) || n < min || n > max) throw new AppError(400, 'bad_input', `A number is out of range (${min}–${max}).`);
  return n;
};
const pick = (v, list) => (list.includes(v) ? v : '');

const P = {
  title: (s) => ({ title: [{ text: { content: s } }] }),
  text: (s) => ({ rich_text: s ? [{ text: { content: s } }] : [] }),
  num: (n) => ({ number: n }),
  sel: (s) => ({ select: s ? { name: s } : null }),
  multi: (list) => ({ multi_select: list.map((name) => ({ name })) }),
  date: (start, end) => ({ date: { start, end: end || null } }),
  rel: (id) => ({ relation: [{ id }] }),
  check: (b) => ({ checkbox: !!b })
};

function read(page, name) {
  const p = page.properties && page.properties[name];
  if (!p) return null;
  switch (p.type) {
    case 'title': return p.title.map((t) => t.plain_text).join('');
    case 'rich_text': return p.rich_text.map((t) => t.plain_text).join('');
    case 'number': return p.number;
    case 'select': return p.select ? p.select.name : null;
    case 'multi_select': return p.multi_select.map((o) => o.name);
    case 'checkbox': return p.checkbox;
    case 'date': return p.date;
    case 'rollup': {
      const r = p.rollup;
      if (!r) return null;
      if (r.type === 'number') return r.number;
      if (r.type === 'array') { // a rollup that lists values instead of summing them
        const nums = r.array.map((x) => (x.type === 'number' ? x.number : x.type === 'formula' && x.formula.type === 'number' ? x.formula.number : null)).filter((x) => x != null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
      }
      return null;
    }
    case 'formula': return p.formula && p.formula.type === 'number' ? p.formula.number : null;
    default: return null;
  }
}

// ---------- Notion ----------
async function notion(path, method = 'GET', body) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new AppError(500, 'setup', 'The Notion key is missing. Add NOTION_TOKEN in Netlify → Site configuration → Environment variables, then redeploy.');
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(NOTION + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new AppError(503, 'notion_down', "Couldn't reach Notion. Try again in a minute.");
    }
    // A 429 means Notion did not run the request, so one retry is safe even for a save.
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 1, 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw notionError(res.status, data);
    return data;
  }
  throw new AppError(503, 'notion_busy', 'Notion is busy. Try again in a moment.');
}

function notionError(status, d) {
  const code = d.code || '';
  if (status === 401) return new AppError(502, 'notion_key', 'Notion rejected the key. Check NOTION_TOKEN in Netlify matches your integration secret.');
  if (status === 404 || code === 'object_not_found' || code === 'restricted_resource')
    return new AppError(502, 'notion_access', 'Notion can\'t see your logs. On the self.v2 page, open ••• → Connections and add your "self.v2 app" connection.');
  if (code === 'validation_error')
    return new AppError(502, 'notion_fields', 'Notion rejected this: ' + (d.message || 'a field didn\'t match') + ' If you renamed something in Notion, the app needs updating.');
  if (status === 429) return new AppError(503, 'notion_busy', 'Notion is busy. Try again in a moment.');
  if (status >= 500) return new AppError(503, 'notion_down', 'Notion didn\'t answer. Try again in a minute.');
  return new AppError(502, 'notion_other', d.message || ('Notion error ' + status));
}

const query = (db, body) => notion(`/databases/${db}/query`, 'POST', body);

async function queryAll(db, body, maxPages = 4) {
  let out = [], cursor;
  for (let i = 0; i < maxPages; i++) {
    const r = await query(db, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out = out.concat(r.results || []);
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return out;
}

// Only touch pages that really belong to the database we expect.
async function ownedPage(id, dbKey) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id)) throw new AppError(400, 'bad_input', 'That item isn\'t valid.');
  const page = await notion(`/pages/${id}`);
  const parent = page.parent && page.parent.database_id;
  if (!parent || plain(parent) !== DB[dbKey]) throw new AppError(403, 'forbidden', 'That item isn\'t part of your self.v2 logs.');
  return page;
}

async function findCheckin(day) {
  const r = await query(DB.checkin, { filter: { property: 'Date', date: { equals: day } }, page_size: 5 });
  return r.results[0] || null;
}

async function ensureCheckin(day) {
  const found = await findCheckin(day);
  if (found) return found;
  return notion('/pages', 'POST', {
    parent: { database_id: DB.checkin },
    properties: { Day: P.title(dayTitle(day)), Date: P.date(day) }
  });
}

function checkinState(page) {
  if (!page) return null;
  const s = { id: page.id, url: page.url };
  HABITS.forEach((h) => { s[h] = !!read(page, h); });
  Object.keys(NUMBERS).forEach((k) => { s[k] = read(page, k); });
  s['Day type'] = read(page, 'Day type');
  s.Location = read(page, 'Location') || '';
  return s;
}

function rangeRow(page) {
  const d = read(page, 'Date');
  const habits = {};
  HABITS.forEach((h) => { habits[h] = !!read(page, h); });
  return {
    day: d && d.start ? d.start.slice(0, 10) : null,
    habits,
    abs: read(page, 'Ab workouts') || 0,
    tea: read(page, 'Herbal tea') || 0,
    calm: read(page, 'Calm'),
    focus: read(page, 'Focus'),
    dayType: read(page, 'Day type'),
    sleep: read(page, 'Sleep hours'),
    kcal: read(page, 'Total calories'),
    lifts: read(page, 'Lifts logged') || 0,
    talks: read(page, 'Talks done') || 0,
    pages: read(page, 'Pages / min read'),
    hobby: read(page, 'Hobby minutes')
  };
}

function streaks(pages, day) {
  const byDay = {};
  pages.forEach((p) => { const d = read(p, 'Date'); if (d && d.start) byDay[d.start.slice(0, 10)] = p; });
  const done = (k, h) => {
    const p = byDay[k]; if (!p) return false;
    return h === 'Abs' ? (read(p, 'Ab workouts') || 0) >= 2 : !!read(p, h);
  };
  const out = {};
  [...HABITS, 'Abs'].forEach((h) => {
    let k = day, n = 0;
    if (!done(k, h)) k = addDays(k, -1);
    while (done(k, h) && n < 400) { n++; k = addDays(k, -1); }
    out[h] = n;
  });
  return out;
}

const SUMMARY = {
  sleep: (p) => {
    const d = read(p, 'Sleep') || {};
    let hours = null;
    if (d.start && d.end) hours = Math.round((Date.parse(d.end) - Date.parse(d.start)) / 36e5 * 10) / 10;
    const feel = read(p, 'Woke up feeling'), q = read(p, 'Quality (1-5)');
    return { title: hours != null ? `Slept ${hours} h` : (read(p, 'Night') || 'Sleep'), detail: [feel, q != null ? `quality ${q}/5` : null].filter(Boolean).join(' · '), tag: 'Sleep', v: hours };
  },
  meal: (p) => ({ title: read(p, 'Item') || 'Meal', detail: read(p, 'Calories') != null ? `${read(p, 'Calories')} kcal` : '', tag: read(p, 'Meal') || 'Food', v: read(p, 'Calories') }),
  lift: (p) => {
    const s = read(p, 'Session');
    const list = Array.isArray(s) ? s : (s ? [s] : []);
    return { title: read(p, 'Exercise') || 'Workout', detail: list.join(', '), tag: 'Workout', v: 1 };
  },
  talk: (p) => ({ title: read(p, 'Topic') || 'Speech', detail: read(p, 'Talk (min)') != null ? `${read(p, 'Talk (min)')} min` : '', tag: 'Speech', v: 1 }),
  reading: (p) => ({ title: read(p, 'Title') || 'Reading', detail: [read(p, 'Pages / Minutes') != null ? `${read(p, 'Pages / Minutes')} pages` : null, read(p, 'Area')].filter(Boolean).join(' · '), tag: read(p, 'Type') || 'Reading', v: read(p, 'Pages / Minutes') }),
  hobby: (p) => ({ title: read(p, 'What I did') || read(p, 'Hobby') || 'Hobby', detail: read(p, 'Minutes') != null ? `${read(p, 'Minutes')} min` : '', tag: read(p, 'Hobby') || 'Hobby', v: read(p, 'Minutes') })
};

const todoSummary = (p) => {
  const d = read(p, 'Date') || {};
  return { id: p.id, title: read(p, 'Task') || 'To-do', time: hhmm(d.start), done: !!read(p, 'Done'), category: read(p, 'Category'), created: p.created_time };
};
const blockSummary = (p) => {
  const d = read(p, 'Planned') || read(p, 'Actual') || {};
  const st = hhmm(d.start), en = hhmm(d.end);
  let du = 0;
  if (d.start && d.end && st && en) du = Math.max(0, Math.round((Date.parse(d.end) - Date.parse(d.start)) / 6e4));
  const sd = d.start ? d.start.slice(0, 10) : null, ed = d.end ? d.end.slice(0, 10) : sd;
  return { id: p.id, title: read(p, 'Block') || 'Block', kind: read(p, 'Kind') || 'Block', category: read(p, 'Category'), start: st, end: en, du, sd, ed, allDay: !st, done: read(p, 'Status') === 'Done', created: p.created_time };
};
const expenseSummary = (p) => {
  const d = read(p, 'Date') || {};
  return { id: p.id, item: read(p, 'Item') || 'Expense', category: read(p, 'Category') || 'Other', amount: read(p, 'Amount') || 0, date: d.start ? d.start.slice(0, 10) : null, notes: read(p, 'Notes') || '' };
};

async function today(day) {
  const [ci, hist, evPages] = await Promise.all([
    findCheckin(day),
    query(DB.checkin, {
      filter: { and: [
        { property: 'Date', date: { on_or_before: day } },
        { property: 'Date', date: { on_or_after: addDays(day, -90) } }
      ] },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 100
    }),
    queryAll(DB.block, { filter: { property: 'Kind', select: { equals: 'Event' } } }, 2)
  ]);
  let entries = [], todos = [], blocks = [];
  if (ci) {
    const rel = { property: 'Check-in day', relation: { contains: ci.id } };
    const jobs = [
      ...Object.keys(SUMMARY).map((kind) => async () => (await query(DB[kind], { filter: rel, page_size: 50 })).results.map((p) => ({ id: p.id, kind, created: p.created_time, ...SUMMARY[kind](p) }))),
      async () => (await query(DB.todo, { filter: rel, page_size: 100 })).results.map(todoSummary).map((t) => ({ ...t, _t: 'todo' })),
      async () => (await query(DB.block, { filter: rel, page_size: 100 })).results.map(blockSummary).map((b) => ({ ...b, _t: 'block' }))
    ];
    // Three at a time, to stay inside Notion's rate limit.
    for (let i = 0; i < jobs.length; i += 3) {
      const batch = await Promise.all(jobs.slice(i, i + 3).map((j) => j()));
      batch.forEach((rows) => rows.forEach((r) => {
        if (r._t === 'todo') { delete r._t; todos.push(r); }
        else if (r._t === 'block') { delete r._t; blocks.push(r); }
        else entries.push(r);
      }));
    }
    entries.sort((a, b) => a.created.localeCompare(b.created));
    todos.sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.created.localeCompare(b.created));
  }
  // Events that run across several days (or were only given an Actual range) show on every day they cover.
  evPages.map(blockSummary).forEach((b) => {
    if (b.sd && b.sd <= day && day <= (b.ed || b.sd) && !blocks.some((x) => x.id === b.id)) blocks.push(b);
  });
  blocks.sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.created.localeCompare(b.created));
  return { day, title: dayTitle(day), checkin: checkinState(ci), streaks: streaks(hist.results, day), entries, todos, blocks };
}

async function range(from, to) {
  if (!isDay(from) || !isDay(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 400) throw new AppError(400, 'bad_input', 'That date range isn\'t valid.');
  const pages = await queryAll(DB.checkin, {
    filter: { and: [{ property: 'Date', date: { on_or_after: from } }, { property: 'Date', date: { on_or_before: to } }] },
    sorts: [{ property: 'Date', direction: 'ascending' }]
  });
  const evPages = await queryAll(DB.block, { filter: { property: 'Kind', select: { equals: 'Event' } } }, 2);
  const eventDays = new Set();
  evPages.map(blockSummary).forEach((b) => {
    if (!b.sd) return;
    let k = b.sd < from ? from : b.sd;
    const end = (b.ed || b.sd) > to ? to : (b.ed || b.sd);
    for (let i = 0; k <= end && i < 400; i++) { eventDays.add(k); k = addDays(k, 1); }
  });
  return { from, to, days: pages.map(rangeRow).filter((r) => r.day), eventDays: [...eventDays] };
}

async function expenses(from, to) {
  if (!isDay(from) || !isDay(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 400) throw new AppError(400, 'bad_input', 'That date range isn\'t valid.');
  const pages = await queryAll(DB.expense, {
    filter: { and: [{ property: 'Date', date: { on_or_after: from } }, { property: 'Date', date: { on_or_before: to } }] },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  const items = pages.map(expenseSummary);
  return { from, to, items, total: items.reduce((a, x) => a + x.amount, 0) };
}

async function setHabit(body) {
  const { day, field, value } = body;
  if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
  let prop;
  if (HABITS.includes(field)) prop = P.check(!!value);
  else if (NUMBERS[field]) prop = P.num(value === null ? null : optNum(value, ...NUMBERS[field]));
  else throw new AppError(400, 'bad_input', 'Unknown habit.');
  const ci = await ensureCheckin(day);
  const page = await notion(`/pages/${ci.id}`, 'PATCH', { properties: { [field]: prop } });
  return { checkin: checkinState(page) };
}

async function setDayMeta(body) {
  const { day } = body;
  if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
  const props = {};
  if ('dayType' in body) {
    if (body.dayType !== null && !DAY_TYPES.includes(body.dayType)) throw new AppError(400, 'bad_input', 'Unknown day type.');
    props['Day type'] = P.sel(body.dayType);
  }
  if ('location' in body) props.Location = P.text(str(body.location, 200));
  if (!Object.keys(props).length) throw new AppError(400, 'bad_input', 'Nothing to save.');
  const ci = await ensureCheckin(day);
  const page = await notion(`/pages/${ci.id}`, 'PATCH', { properties: props });
  return { checkin: checkinState(page) };
}

function stamp(day, time) { return isTime(time) ? `${day}T${time}:00${TZ}` : day; }

function buildEntry(kind, day, f) {
  f = f || {};
  switch (kind) {
    case 'sleep': {
      if (!isTime(f.bed) || !isTime(f.wake)) throw new AppError(400, 'bad_input', 'Add both bedtime and wake-up time.');
      const bedDay = f.bed >= '12:00' ? addDays(day, -1) : day;
      const start = `${bedDay}T${f.bed}:00${TZ}`, end = `${day}T${f.wake}:00${TZ}`;
      if (Date.parse(end) <= Date.parse(start)) throw new AppError(400, 'bad_input', 'Wake-up has to come after bedtime.');
      const n = dayParts(addDays(day, -1));
      const props = { Night: P.title(`Night of ${n.wd} ${n.n}`), Sleep: P.date(start, end) };
      const q = optNum(f.quality, 1, 5); if (q != null) props['Quality (1-5)'] = P.num(q);
      if (FEELINGS.includes(f.feeling)) props['Woke up feeling'] = P.sel(f.feeling);
      return { db: DB.sleep, props };
    }
    case 'meal': {
      const item = str(f.item); if (!item) throw new AppError(400, 'bad_input', 'Say what you ate.');
      const props = { Item: P.title(item), Date: P.date(stamp(day, f.time)) };
      if (MEALS.includes(f.meal)) props.Meal = P.sel(f.meal);
      [['kcal', 'Calories', 0, 5000], ['protein', 'Protein (g)', 0, 500], ['fat', 'Fat (g)', 0, 500], ['carbs', 'Carbs (g)', 0, 1000]].forEach(([k, name, lo, hi]) => {
        const v = optNum(f[k], lo, hi); if (v != null) props[name] = P.num(v);
      });
      return { db: DB.meal, props };
    }
    case 'lift': {
      const ex = str(f.exercise); if (!ex) throw new AppError(400, 'bad_input', 'Add the exercise name.');
      const props = { Exercise: P.title(ex), Date: P.date(day) };
      const raw = Array.isArray(f.sessions) ? f.sessions : (f.session ? [f.session] : []);
      const sessions = raw.filter((s) => SESSIONS.includes(s));
      if (sessions.length) props.Session = P.multi(sessions);
      const notes = str(f.notes, 1000); if (notes) props.Notes = P.text(notes);
      return { db: DB.lift, props, gym: sessions.some((s) => GYM_SESSIONS.includes(s)) };
    }
    case 'talk': {
      const topic = str(f.topic); if (!topic) throw new AppError(400, 'bad_input', 'Add the topic.');
      const props = { Topic: P.title(topic), Date: P.date(day) };
      [['talkMin', 'Talk (min)', 0, 600], ['prepMin', 'Prep (min)', 0, 1000], ['rating', 'Self-rating (1-5)', 1, 5]].forEach(([k, name, lo, hi]) => {
        const v = optNum(f[k], lo, hi); if (v != null) props[name] = P.num(v);
      });
      const notes = str(f.notes, 1000); if (notes) props.Notes = P.text(notes);
      return { db: DB.talk, props };
    }
    case 'reading': {
      const title = str(f.title); if (!title) throw new AppError(400, 'bad_input', 'Add what you read.');
      const props = { Title: P.title(title), Date: P.date(day) };
      const area = str(f.area, 100); if (area) props.Area = P.sel(area);
      const type = str(f.type, 100); if (type) props.Type = P.sel(type);
      const pages = optNum(f.pages, 0, 2000); if (pages != null) props['Pages / Minutes'] = P.num(pages);
      const take = str(f.takeaway, 1500); if (take) props.Takeaway = P.text(take);
      return { db: DB.reading, props };
    }
    case 'hobby': {
      const hobby = str(f.hobby, 100); if (!hobby) throw new AppError(400, 'bad_input', 'Pick a hobby.');
      const props = { 'What I did': P.title(str(f.what) || hobby), Hobby: P.sel(hobby), Date: P.date(day) };
      const m = optNum(f.minutes, 0, 1440); if (m != null) props.Minutes = P.num(m);
      const notes = str(f.notes, 1000); if (notes) props.Notes = P.text(notes);
      return { db: DB.hobby, props };
    }
    default: throw new AppError(400, 'bad_input', 'Unknown log.');
  }
}

async function addLog(body) {
  const { day, kind, fields } = body;
  if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
  const entry = buildEntry(kind, day, fields); // validate before touching Notion
  const ci = await ensureCheckin(day);
  entry.props['Check-in day'] = P.rel(ci.id);
  const page = await notion('/pages', 'POST', { parent: { database_id: entry.db }, properties: entry.props });
  let checkin = checkinState(ci);
  if (entry.gym && !checkin.Gym) {
    try { checkin = checkinState(await notion(`/pages/${ci.id}`, 'PATCH', { properties: { Gym: P.check(true) } })); } catch (e) { /* the workout is saved; the tick can be done by hand */ }
  }
  return { entry: { id: page.id, kind, created: page.created_time, ...SUMMARY[kind](page) }, checkin };
}

async function addTodo(body) {
  const { day } = body;
  if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
  const title = str(body.title); if (!title) throw new AppError(400, 'bad_input', 'Add the to-do.');
  const props = { Task: P.title(title), Date: P.date(stamp(day, body.time)), Done: P.check(false) };
  const cat = pick(body.category, CATEGORIES); if (cat) props.Category = P.sel(cat);
  const notes = str(body.notes, 1000); if (notes) props.Notes = P.text(notes);
  const ci = await ensureCheckin(day);
  props['Check-in day'] = P.rel(ci.id);
  const page = await notion('/pages', 'POST', { parent: { database_id: DB.todo }, properties: props });
  return { todo: todoSummary(page) };
}

async function addBlock(body) {
  const { day } = body;
  if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
  const title = str(body.title); if (!title) throw new AppError(400, 'bad_input', 'Add a title.');
  if (!isTime(body.start) || !isTime(body.end)) throw new AppError(400, 'bad_input', 'Add a start and a finish time.');
  const endDay = body.end <= body.start ? addDays(day, 1) : day; // a finish earlier than the start means past midnight
  const props = {
    Block: P.title(title),
    Kind: P.sel(pick(body.kind, KINDS) || 'Block'),
    Planned: P.date(`${day}T${body.start}:00${TZ}`, `${endDay}T${body.end}:00${TZ}`),
    Status: P.sel('Planned')
  };
  const cat = pick(body.category, CATEGORIES); if (cat) props.Category = P.sel(cat);
  const ci = await ensureCheckin(day);
  props['Check-in day'] = P.rel(ci.id);
  const page = await notion('/pages', 'POST', { parent: { database_id: DB.block }, properties: props });
  return { block: blockSummary(page) };
}

async function addExpense(body) {
  const item = str(body.item); if (!item) throw new AppError(400, 'bad_input', 'Say what it was for.');
  const amount = optNum(body.amount, 0.01, 10000000); if (amount == null) throw new AppError(400, 'bad_input', 'Add the amount.');
  if (!isDay(body.date)) throw new AppError(400, 'bad_input', 'Pick a date.');
  const props = { Item: P.title(item), Amount: P.num(amount), Date: P.date(body.date), Category: P.sel(pick(body.category, EXPENSE_CATS) || 'Other') };
  const notes = str(body.notes, 1000); if (notes) props.Notes = P.text(notes);
  const page = await notion('/pages', 'POST', { parent: { database_id: DB.expense }, properties: props });
  return { expense: expenseSummary(page) };
}

async function setDone(body) {
  const { kind, id, done } = body;
  if (kind === 'todo') {
    await ownedPage(id, 'todo');
    return { todo: todoSummary(await notion(`/pages/${id}`, 'PATCH', { properties: { Done: P.check(!!done) } })) };
  }
  if (kind === 'block') {
    await ownedPage(id, 'block');
    return { block: blockSummary(await notion(`/pages/${id}`, 'PATCH', { properties: { Status: P.sel(done ? 'Done' : 'Planned') } })) };
  }
  throw new AppError(400, 'bad_input', 'Unknown item.');
}

async function removeItem(body) {
  const { kind, id } = body;
  if (!['todo', 'block', 'expense'].includes(kind)) throw new AppError(400, 'bad_input', 'Unknown item.');
  await ownedPage(id, kind);
  await notion(`/pages/${id}`, 'PATCH', { archived: true }); // goes to Notion's Trash, so it can be restored there
  return { ok: true };
}

function passcodeOk(req) {
  const want = process.env.APP_PASSCODE;
  if (!want) throw new AppError(500, 'setup', 'No passcode is set. Add APP_PASSCODE in Netlify → Site configuration → Environment variables, then redeploy.');
  const got = req.headers.get('x-passcode') || '';
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  try {
    if (!passcodeOk(req)) return json(401, { error: 'passcode', message: 'That passcode isn\'t right.' });
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    if (req.method === 'GET') {
      if (route === 'ping') {
        if (!process.env.NOTION_TOKEN) throw new AppError(500, 'setup', 'The Notion key is missing. Add NOTION_TOKEN in Netlify, then redeploy.');
        await notion(`/databases/${DB.checkin}`);
        return json(200, { ok: true });
      }
      if (route === 'today') {
        const day = url.searchParams.get('day');
        if (!isDay(day)) throw new AppError(400, 'bad_input', 'That day isn\'t valid.');
        return json(200, await today(day));
      }
      if (route === 'range') return json(200, await range(url.searchParams.get('from'), url.searchParams.get('to')));
      if (route === 'expenses') return json(200, await expenses(url.searchParams.get('from'), url.searchParams.get('to')));
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => { throw new AppError(400, 'bad_input', 'The request was empty.'); });
      if (route === 'habit') return json(200, await setHabit(body));
      if (route === 'daymeta') return json(200, await setDayMeta(body));
      if (route === 'log') return json(200, await addLog(body));
      if (route === 'todo') return json(200, await addTodo(body));
      if (route === 'block') return json(200, await addBlock(body));
      if (route === 'expense') return json(200, await addExpense(body));
      if (route === 'done') return json(200, await setDone(body));
      if (route === 'remove') return json(200, await removeItem(body));
    }
    return json(404, { error: 'not_found', message: 'Unknown request.' });
  } catch (e) {
    if (e instanceof AppError) return json(e.status, { error: e.code, message: e.message });
    console.error(e);
    return json(500, { error: 'server', message: 'Something went wrong in the app. Try again.' });
  }
};

export const config = { path: '/api/*' };
