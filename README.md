# Imposter: Zoho Catalyst version

This is a multiplayer Imposter game for up to 20 players. Each player uses their own phone, and nobody needs to log in.

- **client/index.html** is the web page. Catalyst serves it with Web Client Hosting.
- **functions/imposter_api/** is the Node.js Express backend, deployed as an Advanced I/O function. It keeps each room in **Catalyst Cache**. Rooms expire after 6 hours, and there are no tables to create.

The server picks the imposter and the words. Each phone receives only its own card, so nobody can find the imposter by looking at the page or the network.

## Deploy (about 10 minutes)

1. **Install the Catalyst CLI and log in.** You need Node.js 18 or later.
   ```sh
   npm install -g zcatalyst-cli
   catalyst login
   ```
   If your account is in the India data centre, pick **IN** when the CLI asks.

2. **Create a project** in the Catalyst console, for example `imposter`.

3. **Initialise the project.** In an empty folder, run:
   ```sh
   catalyst init
   ```
   - Pick the project you just created.
   - Select **Functions** and **Client**.
   - Function settings: stack **Node.js**, type **Advanced I/O**, name **`imposter_api`**. The name matters, because the page calls `/server/imposter_api/...`.
   - Client: choose a **basic web app**. Any app name is fine.

4. **Copy in these files.** Overwrite the ones `catalyst init` generated:
   - `client/index.html`. Keep the generated `client-package.json`.
   - `functions/imposter_api/index.js`
   - `functions/imposter_api/package.json`. Keep the generated `catalyst-config.json`.

5. **Install the function's dependencies:**
   ```sh
   cd functions/imposter_api && npm install && cd ../..
   ```

6. **Deploy:**
   ```sh
   catalyst deploy
   ```
   The CLI prints the client URL, which usually ends in `/app/index.html`. That URL is the link your players open.

## Playing

1. The host opens the link, types their name and taps **Create**. The app shows a 4-letter room code, a QR code and a **Copy invite link** button.
2. Everyone else scans the QR code or opens the invite link, types their name and joins. The lobby fills up live (for example, 12/20).
3. The host picks the maximum number of players (3–20; for example, 15 means only 15 can join), the number of imposters (1–3), what the imposter gets (a similar word or just the category) and a word category. Then the host taps **Start**.
4. Each player taps their card in private. Crew members see the shared word. The imposter sees "You are the imposter 🤫" and a different but similar word.
5. The app picks someone at random to give the first clue. Everyone takes turns giving clues, discusses and votes out loud. Then the host taps **Reveal the imposter**, and the answer appears on every phone.
6. **New round** keeps the same players and picks a new imposter and word. Anyone who joins during a round gets a card in the next one.

If a player refreshes or closes the page, they rejoin automatically, because their seat is remembered on that phone. The host can remove players with ×. If the host leaves, the next player becomes host.

## Test on your own computer first (optional)

```sh
cd functions/imposter_api
npm install
node index.js
```
Then open http://localhost:3000/app/ in a few browser windows, using private windows so each one counts as a separate player. Local mode stores rooms in memory instead of Catalyst Cache.

## Changing words

Edit the `WORDS` object at the top of `functions/imposter_api/index.js`. Each entry is a pair: `["crew word", "imposter word"]`. Run `catalyst deploy` again afterwards.

## If your function has a different name

Change this line near the top of the script in `client/index.html`:
```js
const API = window.IMPOSTER_API || "/server/imposter_api";
```

---

## Free hosting without Catalyst: Render

The same files run as a plain Node.js server. The `package.json` at the top of this folder starts it.

1. Put this folder in a GitHub repository. Upload it at github.com → New repository → "uploading an existing file".
2. On render.com, sign up for free, then choose **New → Web Service** and pick your repository.
3. Use these settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Click **Create Web Service**. When it's live, open `https://<your-name>.onrender.com`. It redirects to the game automatically.

Things to know about Render's free plan:
- The server sleeps after about 15 minutes with no visitors. The first person to open it afterwards waits up to a minute while it wakes up. During a game, the phones check in every 2 seconds, which keeps it awake.
- Rooms are kept in memory. When the server sleeps or restarts, old rooms disappear, so the host creates a new room next time.
