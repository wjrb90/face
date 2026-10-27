// Convierte los resultados de MPFaceTracker en un estado facial (valores 0..1)
// y en eventos discretos (mouthOpen, blink, smileStart, ...) que pueden usar
// los scripts de la escena del editor de three.js.

const average = (a, b) => (a + b) / 2;

// Cada trigger se activa cuando el valor supera `enter` y se desactiva cuando
// baja de `exit` (histeresis), para no disparar eventos repetidos en el limite.
export const DEFAULT_TRIGGERS = [
    { on: "mouthOpen", off: "mouthClose", value: (face) => face.jawOpen, enter: 0.35, exit: 0.2 },
    { on: "smileStart", off: "smileEnd", value: (face) => face.smile, enter: 0.5, exit: 0.3 },
    { on: "blink", off: "blinkEnd", value: (face) => face.blink, enter: 0.5, exit: 0.3 },
    { on: "browRaise", off: "browLower", value: (face) => face.browRaise, enter: 0.5, exit: 0.3 },
];

export const FACE_EVENT_TYPES = [
    "faceUpdate",
    "faceFound",
    "faceLost",
    ...DEFAULT_TRIGGERS.flatMap((trigger) => [trigger.on, trigger.off]),
];

export default class FaceEvents {

    constructor(triggers = DEFAULT_TRIGGERS) {

        this.triggers = triggers.map((trigger) => ({ ...trigger, active: false }));

        this.detected = false;
        this.blendshapes = {};
        this.landmarks = null;
        this.headMatrix = null;

        this.jawOpen = 0;
        this.smile = 0;
        this.blink = 0;
        this.blinkLeft = 0;
        this.blinkRight = 0;
        this.browRaise = 0;

        this.listeners = [];

    }

    // listener(type, event) recibe todos los eventos; ver FACE_EVENT_TYPES.
    addListener(listener) { this.listeners.push(listener); }

    emit(type) {
        for (const listener of this.listeners) {
            listener(type, this);
        }
    }

    update(tracker) {

        const detected = tracker.getFaceCount() > 0;

        if (detected !== this.detected) {
            this.detected = detected;
            this.emit(detected ? "faceFound" : "faceLost");
        }

        if (!detected) {
            this.reset();
            return;
        }

        this.blendshapes = {};
        for (const category of tracker.getBlendShapes()) {
            this.blendshapes[category.categoryName] = category.score;
        }

        const bs = (name) => this.blendshapes[name] ?? 0;

        this.landmarks = tracker.getLandmarks();
        this.headMatrix = tracker.getHeadMatrix();

        this.jawOpen = bs("jawOpen");
        this.smile = average(bs("mouthSmileLeft"), bs("mouthSmileRight"));
        this.blinkLeft = bs("eyeBlinkLeft");
        this.blinkRight = bs("eyeBlinkRight");
        this.blink = average(this.blinkLeft, this.blinkRight);
        this.browRaise = bs("browInnerUp");

        this.emit("faceUpdate");
        this.updateTriggers();

    }

    // Al perder la cara, cierra los triggers activos (p. ej. emite mouthClose).
    reset() {

        this.jawOpen = 0;
        this.smile = 0;
        this.blink = 0;
        this.blinkLeft = 0;
        this.blinkRight = 0;
        this.browRaise = 0;
        this.landmarks = null;
        this.headMatrix = null;

        for (const name of Object.keys(this.blendshapes)) {
            this.blendshapes[name] = 0;
        }

        this.updateTriggers();

    }

    updateTriggers() {

        for (const trigger of this.triggers) {

            const value = trigger.value(this);

            if (!trigger.active && value > trigger.enter) {
                trigger.active = true;
                this.emit(trigger.on);
            } else if (trigger.active && value < trigger.exit) {
                trigger.active = false;
                this.emit(trigger.off);
            }

        }

    }

}
