import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { TextArea, useState } from "@webpack/common";

import { uwuify } from "./convert";
import { settings } from "./settings";

const sample = "Hi everyone! Thanks so much for the help, I really love this little server.";
const newSeed = () => Math.random().toString(36).slice(2);

function TryIt() {
    // Subscribes to every UwUSpeak setting, so the result follows the controls below.
    const { seed: fixedSeed } = settings.use();
    const [text, setText] = useState(sample);
    const [seed, setSeed] = useState(newSeed);

    let result: string;
    try {
        result = uwuify(text, { seed: fixedSeed || seed });
    } catch (e) {
        result = `Can't convert this: ${e instanceof Error ? e.message : e}`;
    }

    return (
        <section className="vc-uwuspeak-try">
            <Paragraph size="md" weight="medium">Try it</Paragraph>
            <Paragraph className="vc-uwuspeak-try-hint">
                Type something to see how it would be sent with the settings below. Faces here come from
                the keyword rules only, without the mood model.
            </Paragraph>
            <TextArea value={text} onChange={setText} rows={2} autosize />
            <div className="vc-uwuspeak-try-result" aria-live="polite">{result}</div>
            <Button
                size="small"
                variant="secondary"
                disabled={!!fixedSeed}
                title={fixedSeed ? "A fixed seed is set, so every result is the same" : undefined}
                onClick={() => setSeed(newSeed())}
            >
                Shuffle
            </Button>
        </section>
    );
}

// A function declaration, so settings.ts can reference it while the import cycle with convert.ts resolves.
export function TryItSetting() {
    return <TryIt />;
}
