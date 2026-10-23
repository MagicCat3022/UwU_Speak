// Tells you when a newer UwUSpeak release is out. Userplugins aren't updated by Vencord's own
// updater, so this checks GitHub once at startup and then twice a day, and offers the install
// command, which updates in place. Only the release tag is fetched; nothing about you is sent.
import { showNotification } from "@api/Notifications";
import { copyToClipboard } from "@utils/clipboard";
import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

import { settings } from "./settings";
import { VERSION } from "./version";

const Native = VencordNative.pluginHelpers.UwUSpeak as PluginNative<typeof import("./native")>;
const logger = new Logger("UwUSpeak");

const RELEASES = "https://github.com/MagicCat3022/UwU_Speak/releases/latest/download";
export const updateCommand = IS_WINDOWS
    ? `irm ${RELEASES}/install.ps1 | iex`
    : `curl -fsSL ${RELEASES}/install.sh | bash`;
const terminal = IS_WINDOWS ? "PowerShell" : "a terminal";

/** True when release tag `latest` (v1.2.3) is newer than `current` (1.2.3). */
export function isNewer(latest: string, current: string) {
    const parse = (v: string) => v.replace(/^v/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const [a, b] = [parse(latest), parse(current)];
    for (let i = 0; i < Math.max(a.length, b.length); i++)
        if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return false;
}

/** The newer release tag, or undefined when up to date or GitHub can't be reached. */
export async function newerRelease(): Promise<string | undefined> {
    const latest = await Native.latestRelease().catch(() => null);
    return latest && isNewer(latest, VERSION) ? latest : undefined;
}

async function check() {
    if (!settings.store.updateNotifications) return;
    const latest = await newerRelease();
    // One notification per release, so ignoring it doesn't bring it back every launch.
    if (!latest || settings.store.notifiedVersion === latest) return;
    settings.store.notifiedVersion = latest;
    logger.info(`UwUSpeak ${latest} is available (you have v${VERSION})`);
    showNotification({
        title: `UwUSpeak ${latest} is available`,
        body: `You have v${VERSION}. Click to copy the update command, then paste it into ${terminal}. /uwu-update shows it again.`,
        permanent: true,
        onClick: () => copyToClipboard(updateCommand),
    });
}

let startup: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

export function startUpdateChecks() {
    // Wait for Discord to finish loading before using the network.
    startup = setTimeout(check, 15_000);
    interval = setInterval(check, 12 * 60 * 60 * 1000);
}

export function stopUpdateChecks() {
    clearTimeout(startup);
    clearInterval(interval);
}
