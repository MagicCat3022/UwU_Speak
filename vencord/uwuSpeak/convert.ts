import { type ConversionOptions, type ConversionResult, convert, type Intensity, type Style } from "./engine";
import { settings } from "./settings";

// Discord syntax the engine does not know about: user/role/channel mentions, custom emoji,
// timestamps, slash command mentions, guild navigation, :shortcodes: and @everyone/@names.
const discordTokens = /<a?:\w+:\d+>|<(?:@[!&]?|#)\d+>|<t:-?\d+(?::[tTdDfFsSR])?>|<\/[\w -]+:\d+>|<id:\w+>|:[\w+-]+:|@[\w.]+/g;

export interface Overrides {
    style?: Style;
    intensity?: Intensity;
    /** Moods from the optional model; they only fill in sentences the keyword rules find neutral. */
    detectedIntents?: string[];
    seed?: string;
}

/** The prose a mood model should read: no mentions, emoji, links or code. */
export const moodText = (text: string) => text
    .replace(/```[\s\S]*?```|`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(discordTokens, " ")
    .trim();

export function buildOptions(text: string, overrides: Overrides = {}): ConversionOptions {
    const s = settings.store;
    const style = overrides.style ?? s.style as Style;
    const nya = style === "nya";
    const preserveTerms = [
        ...s.preserveTerms.split(",").map(t => t.trim()),
        ...Array.from(text.matchAll(discordTokens), m => m[0]),
    ].filter(Boolean);

    const options: ConversionOptions = {
        style,
        intensity: overrides.intensity ?? s.intensity as Intensity,
        seed: overrides.seed ?? (s.seed || Math.random().toString(36).slice(2)),
        quotedText: s.quotedText as "preserve" | "convert",
        preserveTerms: [...new Set(preserveTerms)].slice(0, 256),
        emoticons: {
            enabled: s.faces,
            asciiOnly: s.asciiOnlyFaces,
            intent: s.faceIntent,
            detectedIntents: overrides.detectedIntents ?? [],
        },
    };
    if (!s.customize) return options;

    return {
        ...options,
        nyaScope: s.nyaScope as "words" | "full",
        features: {
            vocabulary: s.vocabulary,
            letterSwap: s.letterSwap,
            nyaSpelling: nya && s.nyaSpelling,
        },
        // The engine rejects nya particles outside nya style.
        rates: {
            stutter: s.stutter,
            stretch: s.stretch,
            tilde: s.tilde,
            nya: nya ? s.nya : 0,
            emoticon: s.emoticon,
        },
        emoticons: { ...options.emoticons, maxIntensity: Math.round(s.maxFaceIntensity) },
        endings: {
            maxPerMessage: Math.round(s.maxEndings),
            minSentenceGap: Math.round(s.sentenceGap),
            allowCombination: s.allowCombination,
        },
    };
}

/** Converts text for display as plain text. */
export function uwuify(text: string, overrides?: Overrides): string {
    if (!text.trim()) return text;
    return convert(text, buildOptions(text, overrides)).text;
}

/** Converts text for sending as a Discord message. */
export function uwuifyForDiscord(text: string, overrides?: Overrides): string {
    if (!text.trim()) return text;
    return escapeFaces(convert(text, { ...buildOptions(text, overrides), diagnostics: true }));
}

/**
 * Discord reads markdown inside faces such as m(_ _)m or ¯\_(ツ)_/¯, so the characters it would
 * consume are escaped in the faces the engine added. The result needs diagnostics; they keep the
 * first 2,000 records in input order, and a face past that point stays unescaped.
 */
export function escapeFaces({ text, diagnostics }: ConversionResult): string {
    let escaped = "", cursor = 0;
    for (const change of diagnostics?.changes ?? []) {
        if (!change.ruleIds.some(id => id.startsWith("emoticon:"))) continue;
        escaped += text.slice(cursor, change.outputStart) + change.after.replace(/[\\*_~|`]/g, "\\$&");
        cursor = change.outputEnd;
    }
    return escaped + text.slice(cursor);
}
