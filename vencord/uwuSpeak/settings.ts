import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { intents } from "./engine";

const title = (s: string) => s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const rate = (description: string, value: number) => ({
    type: OptionType.SLIDER as const,
    description,
    markers: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    stickToMarkers: false,
    default: value,
});

// Advanced defaults mirror the engine's medium preset; they only apply while "customize" is on.
export const settings = definePluginSettings({
    autoConvert: {
        type: OptionType.BOOLEAN,
        description: "Convert every message you send. Right-click the chat bar button to toggle this quickly.",
        default: false,
    },
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the \"Send as UwU\" button in the chat bar.",
        default: true,
    },
    style: {
        type: OptionType.SELECT,
        description: "Dialect.",
        options: [
            { label: "UwU", value: "uwu", default: true },
            { label: "Nya", value: "nya" },
        ],
    },
    intensity: {
        type: OptionType.SELECT,
        description: "Preset strength.",
        options: [
            { label: "Light", value: "light" },
            { label: "Medium", value: "medium", default: true },
            { label: "Heavy", value: "heavy" },
        ],
    },
    seed: {
        type: OptionType.STRING,
        description: "Fixed seed for repeatable output. Leave empty for a fresh result every message.",
        default: "",
    },
    quotedText: {
        type: OptionType.SELECT,
        description: "Text inside quotation marks.",
        options: [
            { label: "Keep as written", value: "preserve", default: true },
            { label: "Convert", value: "convert" },
        ],
    },
    preserveTerms: {
        type: OptionType.STRING,
        description: "Comma-separated words or names to never change. Mentions, emoji, links and code are always kept.",
        default: "",
    },
    faces: {
        type: OptionType.BOOLEAN,
        description: "Add faces like (◕‿◕) where the context fits.",
        default: true,
    },
    asciiOnlyFaces: {
        type: OptionType.BOOLEAN,
        description: "Only use faces made of plain ASCII characters.",
        default: false,
    },
    faceIntent: {
        type: OptionType.SELECT,
        description: "Mood used to pick faces.",
        options: [
            { label: "Detect from message", value: "auto", default: true },
            ...intents.map(i => ({ label: title(i), value: i })),
        ],
    },
    moodModel: {
        type: OptionType.BOOLEAN,
        description: "Use a small AI model to spot moods the keyword rules miss, like joy or amusement, so more messages get a fitting face. It runs on your computer, so messages aren't sent anywhere. Downloads about 30 MB once and uses about 100 MB of memory while on. Needs \"Detect from message\".",
        default: false,
    },
    updateNotifications: {
        type: OptionType.BOOLEAN,
        description: "Tell me when a new UwUSpeak version is out. Checks GitHub at startup and twice a day; nothing about you is sent.",
        default: true,
    },
    notifiedVersion: {
        type: OptionType.STRING,
        description: "The newest release you were already told about.",
        default: "",
        hidden: true,
    },
    customize: {
        type: OptionType.BOOLEAN,
        description: "Override the intensity preset with the advanced settings below.",
        default: false,
    },
    vocabulary: {
        type: OptionType.BOOLEAN,
        description: "Swap words from the vocabulary (love → wuv, small → smol).",
        default: true,
    },
    letterSwap: {
        type: OptionType.BOOLEAN,
        description: "Replace r and l with w.",
        default: true,
    },
    nyaSpelling: {
        type: OptionType.BOOLEAN,
        description: "Nya spelling (no → nyo).",
        default: true,
    },
    nyaScope: {
        type: OptionType.SELECT,
        description: "Where nya spelling applies.",
        options: [
            { label: "Selected words", value: "words", default: true },
            { label: "Every n before a vowel", value: "full" },
        ],
    },
    stutter: rate("Chance of a stutter (h-hello).", 0.03),
    stretch: rate("Chance of extra vowels (haiii).", 0.05),
    tilde: rate("Chance of a tilde at sentence ends.", 0.1),
    nya: rate("Chance of a nya~ particle.", 0.08),
    emoticon: rate("Chance of a face where the context fits.", 0.2),
    maxFaceIntensity: {
        type: OptionType.SLIDER,
        description: "Strongest face allowed (1 = subtle, 3 = intense).",
        markers: [1, 2, 3],
        default: 2,
    },
    maxEndings: {
        type: OptionType.SLIDER,
        description: "Most decorated sentence endings per message.",
        markers: [0, 1, 2, 3, 4, 5],
        default: 2,
    },
    sentenceGap: {
        type: OptionType.SLIDER,
        description: "Minimum sentences between decorated endings.",
        markers: [0, 1, 2, 3, 4, 5],
        default: 2,
    },
    allowCombination: {
        type: OptionType.BOOLEAN,
        description: "Allow a tilde or nya together with a face.",
        default: true,
    },
}, {
    nyaSpelling: { hidden() { return !this.store.customize || this.store.style !== "nya"; } },
    nyaScope: { hidden() { return !this.store.customize || this.store.style !== "nya"; } },
    nya: { hidden() { return !this.store.customize || this.store.style !== "nya"; } },
    vocabulary: { hidden() { return !this.store.customize; } },
    letterSwap: { hidden() { return !this.store.customize; } },
    stutter: { hidden() { return !this.store.customize; } },
    stretch: { hidden() { return !this.store.customize; } },
    tilde: { hidden() { return !this.store.customize; } },
    emoticon: { hidden() { return !this.store.customize; } },
    maxFaceIntensity: { hidden() { return !this.store.customize; } },
    maxEndings: { hidden() { return !this.store.customize; } },
    sentenceGap: { hidden() { return !this.store.customize; } },
    allowCombination: { hidden() { return !this.store.customize; } },
    asciiOnlyFaces: { disabled() { return !this.store.faces; } },
    faceIntent: { disabled() { return !this.store.faces; } },
    moodModel: { disabled() { return !this.store.faces || this.store.faceIntent !== "auto"; } },
});
