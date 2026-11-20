'use strict';
/**
 * Imposter game API — Zoho Catalyst Advanced I/O function (Express).
 * Room state lives in Catalyst Cache (one key per room, expires after 6 h).
 * Secret roles never leave the server: each phone only receives its own card.
 *
 * Production URL: https://<your-project-domain>/server/imposter_api/...
 */
const express = require('express');
const crypto = require('crypto');

let catalyst = null;
try { catalyst = require('zcatalyst-sdk-node'); } catch (e) { /* local dev without SDK */ }

const MAX_PLAYERS = 20;
const MIN_PLAYERS = 3;
const ROOM_TTL_HOURS = 6;
const limitOf = room => Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, +room.settings?.maxPlayers || MAX_PLAYERS));

/* ---------------- Word bank: [crew word, imposter word] ---------------- */
const WORDS = {
  Food: [['Pizza','Burger'],['Biryani','Pulao'],['Samosa','Spring roll'],['Ice cream','Kulfi'],['Coffee','Tea'],['Pancake','Waffle'],['Mango','Papaya'],['Sushi','Dumplings'],['Dosa','Uttapam'],['Chocolate','Caramel'],['Noodles','Pasta'],['Popcorn','Chips'],['Paneer','Tofu'],['Cake','Muffin'],['Lassi','Milkshake'],['Gulab jamun','Rasgulla']],
  Places: [['Beach','Desert'],['Hospital','Pharmacy'],['Airport','Railway station'],['Library','Bookstore'],['Cinema','Theatre'],['Gym','Stadium'],['Temple','Church'],['School','College'],['Zoo','Aquarium'],['Mall','Market'],['Hotel','Hostel'],['Mountain','Hill station'],['Restaurant','Food truck'],['Bank','ATM'],['Museum','Art gallery'],['Park','Garden']],
  Animals: [['Lion','Tiger'],['Dog','Wolf'],['Cat','Rabbit'],['Elephant','Hippo'],['Eagle','Owl'],['Shark','Dolphin'],['Monkey','Gorilla'],['Snake','Lizard'],['Horse','Donkey'],['Peacock','Parrot'],['Penguin','Duck'],['Bee','Butterfly'],['Frog','Turtle'],['Camel','Giraffe'],['Cow','Buffalo']],
  Objects: [['Phone','Laptop'],['Umbrella','Raincoat'],['Pillow','Blanket'],['Watch','Bracelet'],['Mirror','Window'],['Guitar','Violin'],['Candle','Torch'],['Backpack','Suitcase'],['Toothbrush','Comb'],['Scissors','Knife'],['Sunglasses','Spectacles'],['Fan','AC'],['Pen','Pencil'],['Bicycle','Scooter'],['Key','Lock'],['Shoes','Sandals']],
  Jobs: [['Doctor','Nurse'],['Pilot','Astronaut'],['Teacher','Principal'],['Chef','Waiter'],['Police officer','Security guard'],['Firefighter','Lifeguard'],['Actor','Singer'],['Farmer','Gardener'],['Lawyer','Judge'],['Photographer','Painter'],['Engineer','Architect'],['Dentist','Barber'],['Cricketer','Footballer'],['Journalist','YouTuber']],
  Activities: [['Swimming','Surfing'],['Dancing','Singing'],['Camping','Hiking'],['Cooking','Baking'],['Cricket','Baseball'],['Chess','Carrom'],['Yoga','Meditation'],['Shopping','Window shopping'],['Painting','Drawing'],['Wedding','Birthday party'],['Road trip','Train journey'],['Karaoke','Concert'],['Gaming','Watching movies'],['Diwali',"New Year's Eve"]]
};
const CATS = Object.keys(WORDS);

const rand = n => crypto.randomInt(n);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const token = () => crypto.randomBytes(16).toString('hex');
const shortId = () => crypto.randomBytes(4).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[rand(CODE_CHARS.length)]).join('');
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20);

/* ---------------- Storage: Catalyst Cache, or memory for local dev ---------------- */
const memory = new Map();
function store(req) {
  if (catalyst && !process.env.IMPOSTER_MEMORY_STORE) {
    let segment;
    try { segment = catalyst.initialize(req).cache().segment(); } catch (e) { segment = null; }
    if (segment) {
      return {
        async get(key) {
          try {
            const v = await segment.getValue(key);
            if (v == null || v === '') return null;
            return JSON.parse(typeof v === 'string' ? v : (v.cache_value ?? JSON.stringify(v)));
          } catch (e) { return null; }
        },
        async set(key, obj) {
          const val = JSON.stringify(obj);
          try { await segment.update(key, val, ROOM_TTL_HOURS); }
          catch (e) { await segment.put(key, val, ROOM_TTL_HOURS); }
        }
      };
    }
  }
  return {
    async get(key) { const v = memory.get(key); return v ? JSON.parse(v) : null; },
    async set(key, obj) { memory.set(key, JSON.stringify(obj)); }
  };
}
const roomKey = code => 'imp_room_' + code;

/* ---------------- Game logic ---------------- */
function pickRound(room) {
  const s = room.settings;
  const players = room.players.slice(0, limitOf(room));
  const cat = s.category === 'Mixed' || !WORDS[s.category] ? CATS[rand(CATS.length)] : s.category;
  const pair = WORDS[cat][rand(WORDS[cat].length)];
  const flip = rand(2) === 1;
  const nImp = Math.max(1, Math.min(s.imposters, Math.floor((players.length - 1) / 2)));
  const ids = players.map(p => p.id);
  return {
    category: cat,
    word: flip ? pair[1] : pair[0],
    decoy: flip ? pair[0] : pair[1],
    clue: s.clue,
    playerIds: ids,
    imposterIds: shuffle(ids).slice(0, nImp),
    firstId: ids[rand(ids.length)]
  };
}

function publicState(room, me) {
  const nameOf = id => (room.players.find(p => p.id === id) || room.names?.[id] || {}).name || room.roundNames?.[id] || 'Someone';
  const r = room.round;
  const out = {
    code: room.code,
    phase: room.phase,
    roundNo: room.roundNo,
    version: room.version,
    max: limitOf(room), min: MIN_PLAYERS,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, host: p.id === room.hostId })),
    you: me ? { id: me.id, name: me.name, host: me.id === room.hostId } : null
  };
  if (r && room.phase !== 'lobby') {
    out.round = {
      size: r.playerIds.length,
      imposterCount: r.imposterIds.length,
      firstName: nameOf(r.firstId)
    };
    if (me && r.playerIds.includes(me.id)) {
      const imp = r.imposterIds.includes(me.id);
      out.card = imp
        ? { role: 'imposter', word: r.clue === 'word' ? r.decoy : null, category: r.category, clue: r.clue }
        : { role: 'crew', word: r.word, category: r.category };
    } else {
      out.card = null; // joined mid-round
    }
    if (room.phase === 'reveal') {
      out.reveal = { imposters: r.imposterIds.map(nameOf), word: r.word, decoy: r.decoy, clue: r.clue };
    }
  }
  return out;
}

/* ---------------- HTTP ---------------- */
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const fail = (res, status, msg) => res.status(status).json({ error: msg });

async function loadRoom(req, res) {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const room = code.length === 4 ? await store(req).get(roomKey(code)) : null;
  if (!room) { fail(res, 404, 'Room not found. Check the code — rooms expire after a few hours.'); return null; }
  return room;
}
const findMe = (room, tok) => room.players.find(p => p.token === tok) || null;
async function save(req, room) { room.version = (room.version || 0) + 1; room.updatedAt = Date.now(); await store(req).set(roomKey(room.code), room); }

// Create a room; the creator becomes host and first player.
app.post('/rooms', async (req, res) => {
  try {
    const name = cleanName(req.body?.name);
    if (!name) return fail(res, 400, 'Enter your name.');
    const st = store(req);
    let code = null;
    for (let i = 0; i < 8; i++) { const c = newCode(); if (!(await st.get(roomKey(c)))) { code = c; break; } }
    if (!code) return fail(res, 503, 'Could not create a room, try again.');
    const me = { id: shortId(), token: token(), name, joinedAt: Date.now() };
    const room = {
      code, hostId: me.id, phase: 'lobby', roundNo: 0, version: 0,
      settings: { imposters: 1, clue: 'word', category: 'Mixed', maxPlayers: MAX_PLAYERS },
      players: [me], round: null, roundNames: {}
    };
    await save(req, room);
    res.json({ code, token: me.token });
  } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
});

// Join (idempotent: re-sending the same token re-adds you if a concurrent write dropped you).
app.post('/rooms/:code/join', async (req, res) => {
  try {
    const room = await loadRoom(req, res); if (!room) return;
    const name = cleanName(req.body?.name);
    const tok = String(req.body?.token || '');
    let me = tok && findMe(room, tok);
    if (me) return res.json({ token: me.token });
    if (tok && (room.kicked || []).includes(tok)) return fail(res, 403, 'The host removed you from this room.');
    if (!name) return fail(res, 400, 'Enter your name.');
    if (room.players.length >= limitOf(room)) return fail(res, 409, `This room is full (${limitOf(room)} players).`);
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'That name is taken in this room — try another.');
    me = { id: shortId(), token: /^[a-f0-9]{32}$/.test(tok) ? tok : token(), name, joinedAt: Date.now() };
    room.players.push(me);
    await save(req, room);
    res.json({ token: me.token });
  } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
});

app.get('/rooms/:code', async (req, res) => {
  try {
    const room = await loadRoom(req, res); if (!room) return;
    const me = findMe(room, String(req.query.token || ''));
    res.json(publicState(room, me));
  } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
});

// Host-only actions
async function hostAction(req, res, fn) {
  try {
    const room = await loadRoom(req, res); if (!room) return;
    const me = findMe(room, String(req.body?.token || ''));
    if (!me) return fail(res, 403, "You're not in this room.");
    if (me.id !== room.hostId) return fail(res, 403, 'Only the host can do that.');
    const err = fn(room, me);
    if (err) return fail(res, 400, err);
    await save(req, room);
    res.json(publicState(room, me));
  } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
}

app.post('/rooms/:code/settings', (req, res) => hostAction(req, res, room => {
  const s = req.body?.settings || {};
  const imposters = [1, 2, 3].includes(+s.imposters) ? +s.imposters : room.settings.imposters;
  const clue = s.clue === 'category' ? 'category' : s.clue === 'word' ? 'word' : room.settings.clue;
  const category = s.category === 'Mixed' || WORDS[s.category] ? s.category : room.settings.category;
  let maxPlayers = s.maxPlayers == null ? limitOf(room) : Math.round(+s.maxPlayers);
  if (!(maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS)) return `Max players must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`;
  if (maxPlayers < room.players.length) return `${room.players.length} people have already joined — remove some players first, or pick ${room.players.length} or more.`;
  room.settings = { imposters, clue, category, maxPlayers };
}));

app.post('/rooms/:code/start', (req, res) => hostAction(req, res, room => {
  if (room.players.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players.`;
  room.round = pickRound(room);
  room.roundNames = Object.fromEntries(room.players.map(p => [p.id, p.name]));
  room.roundNo += 1;
  room.phase = 'playing';
}));

app.post('/rooms/:code/reveal', (req, res) => hostAction(req, res, room => {
  if (room.phase !== 'playing') return 'No round in progress.';
  room.phase = 'reveal';
}));

app.post('/rooms/:code/lobby', (req, res) => hostAction(req, res, room => { room.phase = 'lobby'; }));

app.post('/rooms/:code/kick', (req, res) => hostAction(req, res, (room, me) => {
  const id = String(req.body?.id || '');
  if (id === me.id) return "You can't remove yourself — you're the host.";
  const gone = room.players.find(p => p.id === id);
  if (gone) room.kicked = [...(room.kicked || []), gone.token].slice(-50);
  room.players = room.players.filter(p => p.id !== id);
}));

app.post('/rooms/:code/leave', async (req, res) => {
  try {
    const room = await loadRoom(req, res); if (!room) return;
    const me = findMe(room, String(req.body?.token || ''));
    if (!me) return res.json({ ok: true });
    room.players = room.players.filter(p => p.id !== me.id);
    if (room.hostId === me.id && room.players.length) room.hostId = room.players[0].id; // hand host to next person
    await save(req, room);
    res.json({ ok: true });
  } catch (e) { console.error(e); fail(res, 500, 'Server error.'); }
});

module.exports = app;

// Local dev: `node index.js` serves the API on :3000 with an in-memory store.
if (require.main === module) {
  process.env.IMPOSTER_MEMORY_STORE = '1';
  const path = require('path');
  const dev = express();
  dev.use('/server/imposter_api', app);
  dev.use('/app', express.static(path.join(__dirname, '../../client')));
  dev.get('/', (req, res) => res.redirect('/app/'));
  dev.listen(process.env.PORT || 3000, () => console.log('Imposter dev server on http://localhost:' + (process.env.PORT || 3000) + '/app/'));
}
