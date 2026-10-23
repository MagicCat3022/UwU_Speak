// Main-process helpers for the optional mood model and the update check. Discord's content
// security policy blocks Hugging Face and GitHub in the renderer, so the model is downloaded here,
// once, into Vencord's data folder and handed to the renderer file by file. Only the pinned files
// below are ever fetched or read.
import { DATA_DIR } from "@main/utils/constants";
import { createHash } from "crypto";
import { IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

const REPO = "minuva/MiniLMv2-goemotions-v2-onnx";
const REVISION = "4fea72b9ec71ba8d84b88e0efa2ace3dcc733bfc";
const FILES: Record<string, { size: number; sha256: string; }> = {
    "config.json": { size: 2011, sha256: "62e826b2e9194c01a14fccdf801cfb3642911af153ff9e08e8823599e3a954a0" },
    "tokenizer.json": { size: 2108882, sha256: "b374924beb422033e02af444719785d778d2511bc7aaa4e9741cb9d580d6567e" },
    "tokenizer_config.json": { size: 1409, sha256: "eb5da385d016d887e16bce6195c44a6edf081873579e04355ad6afc1cb66687d" },
    "model_optimized_quantized.onnx": { size: 30458927, sha256: "594ac3bf3c82e2ea187e50982ea2f811ede5377eaad0c8ad23bc04ee8a2486c6" },
};
const modelDir = join(DATA_DIR, "UwUSpeak", "models", ...REPO.split("/"), REVISION);

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function readVerified(name: string): Promise<Uint8Array | undefined> {
    const data = await readFile(join(modelDir, name)).catch(() => undefined);
    return data && sha256(data) === FILES[name].sha256 ? data : undefined;
}

async function download(name: string) {
    const { size, sha256: expected } = FILES[name];
    const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`);
    if (!res.ok) throw new Error(`Downloading ${name} failed: HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length !== size || sha256(data) !== expected)
        throw new Error(`Downloaded ${name} does not match the pinned version.`);
    // Write to a temporary name first so an interrupted download never looks complete.
    const path = join(modelDir, name);
    await writeFile(path + ".part", data);
    await rename(path + ".part", path);
}

export async function hasModel(_: IpcMainInvokeEvent): Promise<boolean> {
    for (const name of Object.keys(FILES))
        if (!await readVerified(name)) return false;
    return true;
}

let ensuring: Promise<void> | undefined;

/** Downloads any missing or damaged model files. */
export function ensureModel(_: IpcMainInvokeEvent): Promise<void> {
    ensuring ??= (async () => {
        await mkdir(modelDir, { recursive: true });
        for (const name of Object.keys(FILES))
            if (!await readVerified(name)) await download(name);
    })().finally(() => { ensuring = undefined; });
    return ensuring;
}

export async function readModelFile(_: IpcMainInvokeEvent, name: string): Promise<Uint8Array | null> {
    if (!Object.hasOwn(FILES, name)) return null;
    return await readVerified(name) ?? null;
}

/** The tag of the latest UwUSpeak release, such as "v0.3.0", or null when GitHub can't be reached. */
export async function latestRelease(_: IpcMainInvokeEvent): Promise<string | null> {
    try {
        // The redirect to the release page names the tag, without using GitHub's rate-limited API.
        const res = await fetch("https://github.com/MagicCat3022/UwU_Speak/releases/latest", {
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
        });
        const tag = res.headers.get("location")?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
        return tag ? decodeURIComponent(tag) : null;
    } catch {
        return null;
    }
}
