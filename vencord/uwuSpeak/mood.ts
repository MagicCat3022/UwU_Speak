// Optional mood detection with a small local model (MiniLMv2 GoEmotions, about 30 MB). Messages
// never leave your computer: the model runs inside Discord. It loads lazily on first use, and a
// message sent while it is still loading simply uses the keyword rules alone.
import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

import { intentsFromScores, type LabelScore, miniLmCutoff } from "./engine";

const Native = VencordNative.pluginHelpers.UwUSpeak as PluginNative<typeof import("./native")>;
const logger = new Logger("UwUSpeak");

// Pinned version. The library fetches its WebAssembly runtime from the same CDN, which Vencord's
// default content security policy already allows.
const LIBRARY = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";
const MODEL = "minuva/MiniLMv2-goemotions-v2-onnx";
const RETRY_AFTER = 10 * 60_000;

type Classifier = ((text: string, options: { top_k: null; }) => Promise<LabelScore[]>) & {
    dispose(): Promise<void>;
};

let classifier: Classifier | undefined;
let loading: Promise<void> | undefined;
let failedAt = -Infinity;
let lastError: unknown;

export type MoodEvents = { onDownload(): void; onReady(): void; onError(error: unknown): void; };

async function load(onDownload: () => void) {
    if (!await Native.hasModel()) {
        onDownload();
        await Native.ensureModel();
    }

    const T = await import(/* @vite-ignore */ LIBRARY);
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = false;
    // The default caches the runtime as a blob: module, which Discord's policy blocks.
    T.env.useWasmCache = false;
    // Discord is not cross-origin isolated, so WebAssembly threads are unavailable.
    T.env.backends.onnx.wasm.numThreads = 1;
    // Serve the model files from disk instead of Hugging Face.
    T.env.useCustomCache = true;
    T.env.customCache = {
        async match(key: string | Request) {
            const url = typeof key === "string" ? key : key.url;
            const name = url.match(/MiniLMv2-goemotions-v2-onnx\/resolve\/[^/]+\/([^/?]+)$/)?.[1];
            const bytes = name && await Native.readModelFile(name);
            return bytes ? new Response(bytes as Uint8Array<ArrayBuffer>) : undefined;
        },
        async put() { },
    };
    classifier = await T.pipeline("text-classification", MODEL, {
        dtype: "q8",
        subfolder: "",
        model_file_name: "model_optimized",
    });
}

/**
 * Moods the model is confident about, or [] while it is loading or unavailable. Only positive
 * moods are returned; the engine still ignores them for sentences its rules find uncertain.
 */
export async function detectMoods(text: string, events: MoodEvents): Promise<string[]> {
    if (classifier) {
        try {
            return intentsFromScores(await classifier(text, { top_k: null }), miniLmCutoff);
        } catch (e) {
            logger.error("Mood detection failed", e);
            return [];
        }
    }
    if (!loading && Date.now() - failedAt > RETRY_AFTER) {
        loading = load(events.onDownload)
            .then(events.onReady)
            .catch(e => {
                failedAt = Date.now();
                lastError = e;
                logger.error("Could not load the mood model", e);
                events.onError(e);
            })
            .finally(() => { loading = undefined; });
    }
    return [];
}

/** What the model is doing right now, for /uwu-why. */
export function moodStatus(): string {
    if (classifier) return "loaded";
    if (loading) return "loading";
    if (failedAt > -Infinity)
        return `failed (${lastError instanceof Error ? lastError.message : lastError}); retries 10 minutes after the failure`;
    return "not loaded yet (loads on your next converted message)";
}

/** The model's three strongest labels, or undefined while it is not loaded. */
export async function topScores(text: string): Promise<LabelScore[] | undefined> {
    if (!classifier) return;
    const scores = await classifier(text, { top_k: null });
    return [...scores].sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Frees the model's memory; it reloads on next use. */
export function unloadMoodModel() {
    classifier?.dispose().catch(e => logger.error("Could not unload the mood model", e));
    classifier = undefined;
}
