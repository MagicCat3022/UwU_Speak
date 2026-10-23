# UwU Speak

A deterministic English-to-UwU and nya converter, with a browser app, a shared TypeScript engine, and an HTTP API. No model, API key, or conversion service is needed.

## Run it

Install Node.js 22.12 or newer, then:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Conversion runs locally in a web worker. After the page has loaded, it continues working offline in that tab; reloads still need the app's assets.

For the built browser app **and** the API on one server:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3000**. `HOST` and `PORT` can override the default `127.0.0.1:3000`. Use `npm run dev:api` for the API during development.

## What works

- UwU and nya styles, with light, medium, and heavy presets.
- Case-aware spelling, a small vocabulary, optional stutters, extra vowels, tildes, and nya particles.
- Context-guided face selection, deterministic seeds, and spacing and combination controls.
- Preservation of links, code, quotes, identifiers, existing faces, complete Unicode sequences, and custom terms.
- A searchable dictionary of **1,189 faces**, with meanings, usage notes, examples, aliases, sources, and copy buttons.
- An **Emoticon wiki** listing all 5,176 collected faces with how each was judged against the [intake criteria](docs/emoticon-criteria.md).
- Live preview, shuffle, raw-text copying, optional change highlighting, and detailed diagnostics.

Every preview starts from the original input. Changing dialect or intensity restores that preset's conversion settings; the original text, seed, and custom protected terms remain available.

## Use the engine

After building, import the bundled ESM library directly, or import `uwu-speak` when using this project as a local package dependency. TypeScript declarations are included in `dist/types`.

```js
import { convert } from './dist/library/index.js';

const result = convert('Hello world!', {
  intensity: 'light',
  seed: 'demo',
  rates: { stutter: 0, stretch: 0, tilde: 0, nya: 0, emoticon: 0 },
});

console.log(result.text); // Hewwo wowwd!
console.log(result.meta); // Engine, rules, segmentation, dictionary versions, and seed
```

The source entry point is [src/core/index.ts](src/core/index.ts). The core is synchronous and has no DOM, network, storage, or clock dependency. The browser and server call this same implementation.

## Use the API

Send JSON to `POST /v1/convert`:

```json
{
  "text": "Hello world!",
  "options": {
    "intensity": "light",
    "seed": "demo",
    "rates": { "stutter": 0, "stretch": 0, "tilde": 0, "nya": 0, "emoticon": 0 }
  }
}
```

PowerShell example:

```powershell
$uwuRequest = @{
  text = 'Hello world!'
  options = @{
    intensity = 'light'
    rates = @{ stutter = 0; stretch = 0; tilde = 0; nya = 0; emoticon = 0 }
  }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/v1/convert' -Method Post -ContentType 'application/json' -Body $uwuRequest
```

The response is `{ "text": "Hewwo wowwd!", "meta": { ... } }`. Set `options.diagnostics` to `true` to include changes, protected spans, and expression decisions. Errors use `{ "error": { "code": "...", "message": "...", "field": "..." } }`, with `field` present when applicable.

The engine accepts up to 100,000 Unicode code points; the API accepts bodies up to 1 MiB. Invalid text/JSON returns 400, size violations 413, unsupported media types 415, and invalid options 422. Options are validated strictly. Deployment, authentication, and consumer-specific quotas are outside this local adapter.

## Use it in Discord (Vencord plugin)

[vencord/uwuSpeak](vencord/uwuSpeak) is a Vencord user plugin built on the same engine. It adds:

- **`/uwu message:<text>`** sends the converted text, with optional `style`, `intensity`, and `preview` (only you see the result) options. Pending replies are kept.
- **`/uwu-why message:<text>`** shows only you whether the mood model is loaded, its strongest labels, and why each sentence did or didn't get a face (for example, the random face chance: 10%, 20% or 35% per fitting sentence for light, medium or heavy).
- **Update notifications.** At startup and twice a day the plugin asks GitHub for the latest release tag (nothing about you is sent). When a newer version is out, it shows one Vencord notification; clicking it copies the update command. **`/uwu-update`** shows your version and the command any time. Turn this off with *Tell me when a new UwUSpeak version is out*.
- **A "Send as UwU" chat bar button** converts and sends what you typed through Discord's normal composer, so replies and attachments work. Right-click or Shift+click it to turn **Auto UwU** on or off; the icon is highlighted while every message is being converted.
- **Settings** under *Vencord → Plugins → UwUSpeak*: dialect, intensity, seed, quoted text, protected terms, and faces. Turn on *Customize* to override the preset's rates, features, and endings.
- **Mood model (optional, off by default).** The keyword rules only recognize a few situations (greetings, thanks, apologies, bedtime and so on), so most messages get no face. With *Mood model* on, a small classifier ([MiniLMv2 GoEmotions](https://huggingface.co/minuva/MiniLMv2-goemotions-v2-onnx), about 30 MB) also picks faces for positive moods such as joy, amusement or affection. It runs inside Discord, so messages are never sent anywhere. On first use the plugin downloads a pinned, hash-checked copy of the model into `%APPDATA%\Vencord\UwUSpeak\models`, and it loads the inference library ([Transformers.js](https://github.com/huggingface/transformers.js) 4.3.0) from jsDelivr. It adds about 100 MB of memory while on, and classifying takes about 5 ms per message. It never adds sad or angry faces, stays silent wherever the keyword rules detect negation, sarcasm cues or bad news, and can't pick the faces reserved for moods you choose yourself (such as wink or angry). Messages sent while it is still loading use the keyword rules alone. The "Plugin" row in [eval/results/intent-comparison.md](eval/results/intent-comparison.md) shows how it scores.

Mentions, `@everyone`/`@here`, custom emoji, `:shortcodes:`, timestamps, links, and code are always kept as written.

### Install the plugin

Windows: open PowerShell and run the command below, or download and double-click [UwUSpeak-Installer.cmd](https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/UwUSpeak-Installer.cmd).

```powershell
irm https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.ps1 | iex
```

Linux or macOS:

```sh
curl -fsSL https://github.com/MagicCat3022/UwU_Speak/releases/latest/download/install.sh | bash
```

The installer shows what it found, asks a few questions with sensible defaults (arrow keys and Enter), and then does the rest. Run the same command again to update UwUSpeak and Vencord, to repair Discord after an update, or to uninstall. When UwUSpeak and Vencord are already current, it skips the download and rebuild and leaves Discord running; choose *Reinstall* (or pass `--reinstall`) to rebuild anyway. Nothing needs to be installed first:

- **Tools.** It uses your Node.js 22.13+ if you have it, otherwise it downloads a private, checksum-verified copy. It downloads the exact pnpm version Vencord pins. Git is optional: without it, Vencord is downloaded as a snapshot that the installer updates (Vencord's built-in updater needs git).
- **Regular Vencord.** Custom plugins need Vencord built from source, so a Discord that uses the regular Vencord download is switched to a source build in `~/Vencord`. Settings, themes and enabled plugins are kept.
- **Vencord or Equicord built from source.** It finds the folder Discord already loads, adds the plugin there, and offers to update it first (only fast-forwarding a clean checkout). Your other user plugins are untouched.
- **No mod yet.** It downloads Vencord, builds it, and patches Discord with Vencord's own installer.
- **Vesktop.** It points Vesktop's custom Vencord location at the build.
- Discord Stable, PTB, Canary and Development are supported, including Flatpak on Linux (the Snap package isn't supported by Vencord). Apps are only closed after asking, and UwUSpeak is switched on for you when the app is closed.

To skip the questions or script it, pass options after `bash -s --` (shell) or set `UWUSPEAK_ARGS` (PowerShell), for example `--yes --target discord`. `--help` lists them all, including `--dir`, `--release`, `--uninstall` and `--dry-run`. Logs are kept in `%LOCALAPPDATA%UwUSpeaklogs` (Windows), `~/Library/Application Support/UwUSpeak/logs` (macOS) or `~/.local/share/uwuspeak/logs` (Linux).

Already build Vencord from source yourself? Extract `uwuSpeak.zip` from the [latest release](https://github.com/MagicCat3022/UwU_Speak/releases/latest) into its `src/userplugins` folder, run `pnpm build`, and restart Discord.

### Develop the plugin

To build the plugin from this repository instead, install git, Node.js, and pnpm (`npm i -g pnpm`), then:

```sh
git clone https://github.com/Vendicated/Vencord ../Vencord   # next to this repository
npm run vencord:install                                        # bundles the engine into ../Vencord/src/userplugins/uwuSpeak
cd ../Vencord
pnpm install --frozen-lockfile
pnpm build
pnpm inject                                                    # patch Discord to use this build, then restart Discord
```

Enable **UwUSpeak** in *Settings → Vencord → Plugins*. After changing the engine or plugin, run `npm run vencord:install`, then `pnpm build` in Vencord and reload Discord (Ctrl+R). Changes to `native.ts` need a full Discord restart instead. `pnpm inject` is only needed once and after Discord updates that remove Vencord. Your existing Vencord settings are kept, since they live in `%APPDATA%\Vencord\settings` either way.

`engine.js`, `engine.d.ts` and `version.ts` in the plugin folder are generated by `npm run vencord:build`; don't edit them.

## Verify and develop

```sh
npm run check                   # Type-check plus core and HTTP tests
npx playwright install chromium # Once per machine
npm run test:browser            # Build and test the real app in Chromium
npm run test:all                # Both suites
npm run benchmark              # Short, maximum-size, and adversarial inputs
npm run format                 # Format source, tests, and configuration
npm run eval:intent            # Compare mood detectors on eval/intent-corpus.json (downloads ~225 MB of models once)
```

The browser suite starts the built app on port 3000, which must be free. It verifies clipboard behavior, offline conversion, mobile layout, text rendering, dictionary controls, large inputs, and browser/API/library parity. Screenshots are written under `test-results/`.

## Design and limits

This is an English plain-text converter. Tone matching uses cautious phrase rules; it does not understand every joke, negation, name, or emotion. Some dictionary faces remain reference-only until suitable context rules exist. HTML/Markdown documents are not parsed as structured documents, and converting already converted text is not guaranteed to be idempotent.

- [Converter specification](docs/converter-spec.md): rules, presets, protected text, options, and API contract.
- [Implementation notes](docs/implementation.md): architecture, determinism, active expression rules, limits, and measured performance.
- [Review collection](docs/converter-examples.md): 40 exact and behavioral cases, now covered by automated checks.
- [Emoticon dictionary](data/emoticons.json) and [dictionary guide](docs/emoticon-dictionary.md): researched forms and editorial usage guidance.

Face meanings vary with context and community. Passing structural tests does not establish that every output sounds natural; keep reviewing real examples as the rules grow.

## Release a new version

1. Update `version` in `package.json` and `package-lock.json` (for example with `npm version 0.2.0 --no-git-tag-version`).
2. Run `npm run vencord:build` and commit the regenerated `vencord/uwuSpeak/engine.*` and `version.ts` files. The plugin compares `version.ts` with the latest release to offer updates.
3. Push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`.

The [Plugin workflow](.github/workflows/plugin.yml) runs the tests, runs the installer end to end on Windows, macOS and Linux (building into the latest Vencord and Equicord and patching a fake Discord), and publishes a GitHub release with the plugin, the installers and their checksums. The install commands above always fetch the latest release.

## License

[MIT](LICENSE)
