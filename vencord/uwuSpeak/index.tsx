import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { plugins } from "@api/PluginManager";
import { openPluginModal } from "@components/settings";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent } from "@utils/types";
import { ContextMenuApi, FluxDispatcher, Menu, MessageActions, PendingReplyStore, UserStore } from "@webpack/common";

import { buildOptions, escapeFaces, moodText, Overrides, uwuifyForDiscord } from "./convert";
import { convert, type Intensity, miniLmCutoff, type Style } from "./engine";
import { detectMoods, moodStatus, topScores, unloadMoodModel } from "./mood";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";
import { newerRelease, startUpdateChecks, stopUpdateChecks, updateCommand } from "./update";
import { VERSION } from "./version";

const logger = new Logger("UwUSpeak");

const UwuIcon: IconComponent = ({ height = 20, width = 20, className, style }) => (
    <svg viewBox="0 0 24 24" height={height} width={width} className={className} style={style}
        fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M6.5 9v1.5a1.75 1.75 0 0 0 3.5 0V9" />
        <path d="M14 9v1.5a1.75 1.75 0 0 0 3.5 0V9" />
        <path d="M8.5 15l1.75 1.75L12 15l1.75 1.75L15.5 15" />
    </svg>
);

// Vencord's showToast currently crashes Discord (React error #31), so feedback is shown as a
// message only you can see instead.
const notify = (channelId: string, content: string) =>
    sendBotMessage(channelId, { content, author: { username: "UwUSpeak" } });

const maxLength = () => UserStore.getCurrentUser()?.premiumType === 2 ? 4000 : 2000;

/** Converts text, or explains why it could not and returns undefined. */
function tryUwuify(channelId: string, text: string, overrides?: Overrides): string | undefined {
    try {
        const result = uwuifyForDiscord(text, overrides);
        if (result.length > maxLength()) {
            notify(channelId, "The UwU version is too long for Discord, so your message was sent unconverted.");
            return;
        }
        return result;
    } catch (e) {
        logger.error("Conversion failed", e);
        notify(channelId, `UwU conversion failed: ${e instanceof Error ? e.message : e}`);
    }
}

/** Moods from the optional model, or [] when it is off, still loading or the message has no prose. */
async function moodsFor(channelId: string, text: string): Promise<string[]> {
    const { moodModel, faces, faceIntent } = settings.store;
    if (!moodModel || !faces || faceIntent !== "auto") {
        unloadMoodModel();
        return [];
    }
    const prose = moodText(text);
    if (!prose) return [];
    return detectMoods(prose, {
        onDownload: () => notify(channelId,
            "Downloading the mood model (about 30 MB, only once). Until it's ready, faces use the keyword rules."),
        onReady: () => notify(channelId, "The mood model is ready. Use /uwu-why to see what it detects in a message."),
        onError: e => notify(channelId,
            `Couldn't load the mood model, so faces use the keyword rules for now. ${e instanceof Error ? e.message : e}`),
    });
}

// Why each sentence did or did not get a face, in the engine's own reason codes.
const faceReasons: Record<string, string> = {
    selected: "got a face",
    rate_not_selected: "mood fits, but the random face chance didn't pick it this time",
    no_matching_intent: "no mood detected",
    unsupported_eligibility: "mood detected, but no face for it may be added automatically",
    context_uncertain: "skipped: the sentence looks negated, sarcastic, sad or reported",
    existing_ending: "skipped: it already ends with a face or particle",
    protected_content: "skipped: nothing but links, code or quotes",
    budget_exhausted: "skipped: the per-message limit on decorated endings was reached",
    disabled: "faces are turned off",
};
const faceChance = () => settings.store.customize
    ? settings.store.emoticon
    : { light: 0.1, medium: 0.2, heavy: 0.35 }[settings.store.intensity as Intensity];

/** Explains the mood model and face decisions for a message, without sending anything. */
async function explain(channelId: string, text: string): Promise<string> {
    const { moodModel, faces, faceIntent } = settings.store;
    const prose = moodText(text);
    const modelOn = moodModel && faces && faceIntent === "auto";
    // Starts loading the model if needed, exactly like a real send.
    const moods = await moodsFor(channelId, text);
    const top = modelOn && prose ? await topScores(prose).catch(() => undefined) : undefined;

    const lines = [`**Mood model:** ${modelOn ? moodStatus() : "off"}`];
    if (!modelOn) lines.push("-# Turn on \"Mood model\" with faces on and face mood set to \"Detect from message\".");
    if (top) lines.push(`-# Top labels: ${top.map(s => `${s.label} ${Math.round(s.score * 100)}%`).join(" · ")}`);
    if (modelOn)
        lines.push(`-# Moods it adds: ${moods.join(", ") || `none (it needs a positive mood at ${miniLmCutoff * 100}% or more that beats neutral)`}`);

    const result = convert(text, { ...buildOptions(text, { detectedIntents: moods }), diagnostics: true });
    lines.push("", `**Faces** · ${Math.round(faceChance() * 100)}% chance per fitting sentence`);
    let lastSentence: number | undefined;
    for (const d of result.diagnostics?.decisions ?? []) {
        if (d.ruleId !== "emoticon" && d.ruleId !== "ending") continue;
        if (d.inputStart !== lastSentence) {
            const sentence = text.slice(d.inputStart, d.inputEnd).replace(/\s+/g, " ").trim();
            lines.push(`> ${sentence.length > 80 ? `${sentence.slice(0, 79)}…` : sentence}`);
            lastSentence = d.inputStart;
        }
        const reason = `${faceReasons[d.reasonCode] ?? d.reasonCode}${d.intent ? ` (mood: ${d.intent.replaceAll("_", " ")})` : ""}`;
        lines.push(d.outcome === "selected" ? `**${reason}**` : reason);
    }
    lines.push("", "**One possible result**", escapeFaces(result));
    return lines.join("\n");
}

// The send button arms a one-shot conversion, then submits through Discord's own composer so
// replies, attachments, slowmode and drafts behave exactly like a normal send.
let armedChannel: string | undefined;
let armTimer: ReturnType<typeof setTimeout> | undefined;

function disarm() {
    armedChannel = undefined;
    clearTimeout(armTimer);
}

function sendAsUwu(channelId: string, button: HTMLElement) {
    const textbox = button.closest("form")?.querySelector<HTMLElement>("[role=\"textbox\"]");
    if (!textbox) {
        notify(channelId, "Couldn't find the message box. Use /uwu instead.");
        return;
    }
    armedChannel = channelId;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
        if (armedChannel === undefined) return;
        disarm();
        notify(channelId, "Discord didn't send the message. Press Enter, or use /uwu.");
    }, 2000);
    textbox.focus();
    textbox.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
}

const choice = (label: string, value: string) => ({ name: label, label, value });
const styleChoices = [choice("UwU", "uwu"), choice("Nya", "nya")];
const intensityChoices = [choice("Light", "light"), choice("Medium", "medium"), choice("Heavy", "heavy")];

function QuickMenu() {
    const s = settings.use(["autoConvert", "style", "intensity"]);
    return (
        <Menu.Menu
            navId="vc-uwuspeak-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="UwUSpeak options"
        >
            <Menu.MenuCheckboxItem
                id="vc-uwuspeak-auto"
                label="Auto UwU (convert every message)"
                checked={s.autoConvert}
                action={() => { s.autoConvert = !s.autoConvert; }}
            />
            <Menu.MenuSeparator />
            <Menu.MenuGroup label="Style">
                {styleChoices.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-uwuspeak-style-${value}`}
                        group="vc-uwuspeak-style"
                        label={label}
                        checked={s.style === value}
                        action={() => { s.style = value; }}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuGroup label="Intensity">
                {intensityChoices.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-uwuspeak-intensity-${value}`}
                        group="vc-uwuspeak-intensity"
                        label={label}
                        checked={s.intensity === value}
                        action={() => { s.intensity = value; }}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-uwuspeak-settings"
                label="All settings"
                action={() => openPluginModal(plugins.UwUSpeak)}
            />
        </Menu.Menu>
    );
}

const SendAsUwuButton: ChatBarButtonFactory = ({ isAnyChat, isEmpty, channel }) => {
    const { autoConvert, showChatBarButton } = settings.use(["autoConvert", "showChatBarButton"]);
    if (!isAnyChat || !showChatBarButton) return null;

    // The highlighted icon and tooltip show the current state.
    return (
        <ChatBarButton
            tooltip={autoConvert
                ? "Auto UwU is on (right-click for options)"
                : "Send as UwU (right-click for options)"}
            onClick={e => {
                if (e.shiftKey) {
                    settings.store.autoConvert = !autoConvert;
                    return;
                }
                if (isEmpty) return;
                sendAsUwu(channel.id, e.currentTarget as HTMLElement);
            }}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <QuickMenu />)}
        >
            <UwuIcon style={autoConvert ? { color: "var(--text-brand, var(--brand-500))" } : undefined} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "UwUSpeak",
    description: "Convert your messages to UwU or nya speak with /uwu, a \"Send as UwU\" chat bar button, or automatically.",
    tags: ["Chat", "Fun"],
    authors: [{ name: "MagicCat3022", id: 297550393435488257n }],
    settings,
    managedStyle,

    chatBarButton: {
        icon: UwuIcon,
        render: SendAsUwuButton,
    },

    start() {
        startUpdateChecks();
    },

    stop() {
        disarm();
        unloadMoodModel();
        stopUpdateChecks();
    },

    async onBeforeMessageSend(channelId, message) {
        const armed = armedChannel === channelId;
        if (armed) disarm();
        if (!armed && !settings.store.autoConvert) return;
        if (!message.content) return;

        const detectedIntents = await moodsFor(channelId, message.content);
        const converted = tryUwuify(channelId, message.content, { detectedIntents });
        if (converted !== undefined) message.content = converted;
    },

    commands: [{
        name: "uwu-update",
        description: "Check for a newer UwUSpeak and show how to update (only you see it)",
        inputType: ApplicationCommandInputType.BUILT_IN,
        async execute(_, { channel }) {
            const latest = await newerRelease();
            const status = latest
                ? `**UwUSpeak ${latest} is available** (you have v${VERSION}).`
                : `You have UwUSpeak v${VERSION}, the latest version (or GitHub couldn't be reached).`;
            notify(channel.id, `${status}\nTo update, run this, then restart Discord:\n\`\`\`\n${updateCommand}\n\`\`\``);
        },
    }, {
        name: "uwu-why",
        description: "Show what the mood model detects and why a face would or wouldn't be added (only you see it)",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "message",
            description: "Text to check",
            type: ApplicationCommandOptionType.STRING,
            required: true,
        }],
        async execute(args, { channel }) {
            try {
                notify(channel.id, await explain(channel.id, findOption(args, "message", "")));
            } catch (e) {
                logger.error("Explaining failed", e);
                notify(channel.id, `Couldn't explain that message: ${e instanceof Error ? e.message : e}`);
            }
        },
    }, {
        name: "uwu",
        description: "Send a message converted to UwU speak",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "message",
                description: "What to say",
                type: ApplicationCommandOptionType.STRING,
                required: true,
            },
            {
                name: "style",
                description: "Dialect (defaults to your plugin settings)",
                type: ApplicationCommandOptionType.STRING,
                choices: styleChoices,
            },
            {
                name: "intensity",
                description: "Strength (defaults to your plugin settings)",
                type: ApplicationCommandOptionType.STRING,
                choices: intensityChoices,
            },
            {
                name: "preview",
                description: "Only show the result to you instead of sending it",
                type: ApplicationCommandOptionType.BOOLEAN,
            },
        ],
        async execute(args, { channel }) {
            const message = findOption(args, "message", "");
            const text = tryUwuify(channel.id, message, {
                style: findOption<Style>(args, "style"),
                intensity: findOption<Intensity>(args, "intensity"),
                detectedIntents: await moodsFor(channel.id, message),
            });
            if (text === undefined) return;

            if (findOption(args, "preview", false)) {
                notify(channel.id, text);
                return;
            }
            const reply = PendingReplyStore.getPendingReply(channel.id);
            sendMessage(channel.id, { content: text }, false, MessageActions.getSendMessageOptionsForReply(reply));
            FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId: channel.id });
        },
    }],
});
