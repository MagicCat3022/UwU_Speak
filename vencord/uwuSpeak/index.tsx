import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent } from "@utils/types";
import { FluxDispatcher, MessageActions, PendingReplyStore, UserStore } from "@webpack/common";

import { buildOptions, moodText, Overrides, uwuify } from "./convert";
import { convert, type Intensity, miniLmCutoff, type Style } from "./engine";
import { detectMoods, moodStatus, topScores, unloadMoodModel } from "./mood";
import { settings } from "./settings";
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
        const result = uwuify(text, overrides);
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

    const lines = [
        `**Mood model:** ${modelOn ? moodStatus() : "off (turn on \"Mood model\" with faces on and face mood set to Auto)"}`,
    ];
    if (top) lines.push(`**Model's top labels:** ${top.map(s => `${s.label} ${Math.round(s.score * 100)}%`).join(", ")}`);
    if (modelOn)
        lines.push(`**Moods it adds:** ${moods.join(", ") || `none (it needs a positive mood at ${miniLmCutoff * 100}% or more that beats neutral)`}`);

    const result = convert(text, { ...buildOptions(text, { detectedIntents: moods }), diagnostics: true });
    lines.push(`**Face chance per fitting sentence:** ${Math.round(faceChance() * 100)}%`);
    for (const d of result.diagnostics?.decisions ?? []) {
        if (d.ruleId !== "emoticon" && d.ruleId !== "ending") continue;
        const sentence = text.slice(d.inputStart, d.inputEnd).trim();
        const mood = d.intent ? ` (mood: ${d.intent.replaceAll("_", " ")})` : "";
        lines.push(`- "${sentence.slice(0, 80)}"${mood}: ${faceReasons[d.reasonCode] ?? d.reasonCode}`);
    }
    lines.push(`**One possible result:** ${result.text}`);
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

const SendAsUwuButton: ChatBarButtonFactory = ({ isAnyChat, isEmpty, channel }) => {
    const { autoConvert, showChatBarButton } = settings.use(["autoConvert", "showChatBarButton"]);
    if (!isAnyChat || !showChatBarButton) return null;

    // The highlighted icon and tooltip show the current state.
    const toggle = () => { settings.store.autoConvert = !autoConvert; };

    return (
        <ChatBarButton
            tooltip={autoConvert
                ? "Auto UwU is on (right-click to turn off)"
                : "Send as UwU (right-click: convert every message)"}
            onClick={e => {
                if (e.shiftKey) return toggle();
                if (isEmpty) return;
                sendAsUwu(channel.id, e.currentTarget as HTMLElement);
            }}
            onContextMenu={e => {
                e.preventDefault();
                toggle();
            }}
        >
            <UwuIcon style={autoConvert ? { color: "var(--text-brand, var(--brand-500))" } : undefined} />
        </ChatBarButton>
    );
};

const choice = (label: string, value: string) => ({ name: label, label, value });

export default definePlugin({
    name: "UwUSpeak",
    description: "Convert your messages to UwU or nya speak with /uwu, a \"Send as UwU\" chat bar button, or automatically.",
    tags: ["Chat", "Fun"],
    authors: [{ name: "Magic", id: 0n }],
    settings,

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
                choices: [choice("UwU", "uwu"), choice("Nya", "nya")],
            },
            {
                name: "intensity",
                description: "Strength (defaults to your plugin settings)",
                type: ApplicationCommandOptionType.STRING,
                choices: [choice("Light", "light"), choice("Medium", "medium"), choice("Heavy", "heavy")],
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
                sendBotMessage(channel.id, { content: text });
                return;
            }
            const reply = PendingReplyStore.getPendingReply(channel.id);
            sendMessage(channel.id, { content: text }, false, MessageActions.getSendMessageOptionsForReply(reply));
            FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId: channel.id });
        },
    }],
});
