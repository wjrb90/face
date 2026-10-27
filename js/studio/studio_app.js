import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";

import TextureStudio from "./texture_studio.js";
import WebCamera from "../webcamera.js";
import MPFaceTracker from "../mediapipe/mp_face_tracker.js";
import { FACE_REGIONS, unwrapToUV, renderFaceTexture, uvToCanvas } from "../mediapipe/face_uv.js";
import { createFaceMask } from "../mediapipe/face_mask.js";

const MODEL_PATH = "./assets/mediapipe/face_landmarker.task";
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const PREVIEW_TEXTURE_SIZE = 512;
const PREVIEW_MAX_WIDTH = 720;
const CHEEK_LANDMARK = 50;

const BLEND_MODES = [
    ["source-over", "Normal"],
    ["multiply", "Multiplicar"],
    ["screen", "Trama"],
    ["overlay", "Superponer"],
    ["soft-light", "Luz suave"],
    ["color", "Color"],
];

const $ = (id) => document.getElementById(id);
const refreshIcons = () => window.lucide?.createIcons();

const studio = new TextureStudio($("uv-canvas"), $("uv-overlay"));

// --- Utilidades ------------------------------------------------------------

let statusTimer = null;

function setStatus(text, persist = false) {
    $("status").textContent = text;
    clearTimeout(statusTimer);
    if (text && !persist) statusTimer = setTimeout(() => { $("status").textContent = ""; }, 4000);
}

async function loadImage(file) {
    const image = new Image();
    image.src = URL.createObjectURL(file);
    await image.decode();
    return image;
}

function download(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => download(blob, filename), "image/png");
}

function landmarkPosition(index) {
    const p = uvToCanvas(index, 1);
    return { x: p.x, y: p.y };
}

// Colorea el relleno de un slider de Basecoat (tambien al cambiarlo por codigo).
function syncRange(input) {
    const min = parseFloat(input.min), max = parseFloat(input.max), value = parseFloat(input.value);
    input.style.setProperty("--slider-value", `${((value - min) / (max - min)) * 100}%`);
}

// --- Stickers generados (texto y formas), editables despues ----------------

function seededRandom(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function textCanvas(text, color) {
    const fontSize = 200;
    const font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Geist, sans-serif`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    canvas.width = Math.max(1, Math.ceil(ctx.measureText(text || " ").width) + 40);
    canvas.height = fontSize * 1.3;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    return canvas;
}

function shapeCanvas(shape, color, seed = 1) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const c = size / 2;
    ctx.fillStyle = color;

    if (shape === "blush") {
        const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
        gradient.addColorStop(0, color + "e6");
        gradient.addColorStop(1, color + "00");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
    } else if (shape === "freckles") {
        const random = seededRandom(seed);
        for (let i = 0; i < 40; i++) {
            const angle = random() * Math.PI * 2;
            const radius = Math.sqrt(random()) * c * 0.9;
            ctx.globalAlpha = 0.4 + random() * 0.5;
            ctx.beginPath();
            ctx.arc(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius * 0.6, 3 + random() * 5, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (shape === "heart") {
        ctx.beginPath();
        ctx.moveTo(c, size * 0.88);
        ctx.bezierCurveTo(size * 0.1, size * 0.55, size * 0.05, size * 0.2, c * 0.55, size * 0.15);
        ctx.bezierCurveTo(c * 0.8, size * 0.1, c, size * 0.25, c, size * 0.32);
        ctx.bezierCurveTo(c, size * 0.25, c * 1.2, size * 0.1, c * 1.45, size * 0.15);
        ctx.bezierCurveTo(size * 0.95, size * 0.2, size * 0.9, size * 0.55, c, size * 0.88);
        ctx.fill();
    } else if (shape === "star") {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
            const radius = k % 2 === 0 ? c * 0.95 : c * 0.4;
            const angle = -Math.PI / 2 + k * Math.PI / 5;
            ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
    }

    return canvas;
}

function generate(generator) {
    return generator.kind === "text"
        ? textCanvas(generator.text, generator.color)
        : shapeCanvas(generator.shape, generator.color, generator.seed);
}

const SHAPES = {
    blush: { name: "Rubor", color: "#ff6f91", options: () => ({ ...landmarkPosition(CHEEK_LANDMARK), width: 0.2, mirror: true, opacity: 0.6 }) },
    freckles: { name: "Pecas", color: "#8d5a3b", options: () => ({ ...landmarkPosition(CHEEK_LANDMARK), width: 0.18, mirror: true, opacity: 0.8 }) },
    heart: { name: "Corazón", color: "#ff4d6d", options: () => ({ width: 0.1 }) },
    star: { name: "Estrella", color: "#ffd43b", options: () => ({ width: 0.1 }) },
};

const REGION_DEFAULTS = {
    lips: { name: "Labios", color: "#c2185b", opacity: 0.7 },
    eyes: { name: "Delineado de ojos", color: "#111111", mode: "stroke", lineWidth: 0.005, blur: 0.001 },
    brows: { name: "Cejas", color: "#3b2a20", opacity: 0.6 },
    face: { name: "Cara completa", color: "#4caf50", opacity: 0.85, blur: 0.006 },
};

function addGenerated(generator, name, options = {}) {
    return studio.addImageLayer(generate(generator), { name, generator, ...options });
}

function addShape(key) {
    const shape = SHAPES[key];
    const generator = { kind: "shape", shape: key, color: shape.color, seed: Math.floor(Math.random() * 1e9) };
    addGenerated(generator, shape.name, shape.options());
}

function addRegion(key) {
    studio.addRegionLayer(key, REGION_DEFAULTS[key]);
}

// --- Foto de referencia ----------------------------------------------------

let imageLandmarker = null;
let photo = null;

async function getImageLandmarker() {
    if (imageLandmarker) return imageLandmarker;
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    imageLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "IMAGE",
        numFaces: 1
    });
    return imageLandmarker;
}

$("photo-input").addEventListener("change", async (event) => {

    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
        setStatus("Detectando la cara…", true);
        const image = await loadImage(file);
        const landmarker = await getImageLandmarker();
        const landmarks = landmarker.detect(image).faceLandmarks[0];

        if (!landmarks) {
            setStatus("No se detectó ninguna cara en la foto.");
            return;
        }

        photo = { image, landmarks };
        const layer = studio.addImageLayer(unwrapToUV(image, landmarks, 1024), { name: "Foto desplegada", width: 1, photo: true });

        // La foto va al fondo, debajo del resto de capas.
        studio.layers.splice(studio.layers.indexOf(layer), 1);
        studio.layers.unshift(layer);
        studio.changed();

        setPreviewMode("photo");
        setStatus("Foto desplegada en el mapa UV.");
    } catch (error) {
        console.error(error);
        setStatus("Error al procesar la foto (ver consola).");
    }

});

$("sticker-input").addEventListener("change", async (event) => {
    for (const file of event.target.files) {
        const image = await loadImage(file);
        studio.addImageLayer(image, { name: file.name.replace(/\.[^.]+$/, "") });
    }
    event.target.value = "";
});

// --- Diálogo de texto ------------------------------------------------------

function confirmText() {
    const text = $("text-input").value.trim();
    if (!text) return;
    addGenerated({ kind: "text", text, color: $("text-color").value }, `Texto: ${text}`, { width: 0.12 });
    $("text-dialog").close();
}

$("text-confirm").addEventListener("click", confirmText);
$("text-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    // Sin preventDefault, el Enter llega al boton "+" (que recupera el foco) y reabre el menu.
    event.preventDefault();
    confirmText();
});

// --- Acciones (menús y botones con data-action) ----------------------------

const actions = {
    sticker: () => $("sticker-input").click(),
    photo: () => $("photo-input").click(),
    text: () => { $("text-dialog").showModal(); $("text-input").select(); },
    shape: addShape,
    region: addRegion,
    paint: () => studio.addPaintLayer(),
    undo: () => studio.undo(),
    duplicate: () => studio.selected && studio.duplicateLayer(studio.selected),
    delete: () => studio.selected && studio.removeLayer(studio.selected),
    "export-mask": exportMask,
    "export-png": () => downloadCanvas(studio.exportCanvas(exportSize()), "textura_facial.png"),
    "export-template": exportTemplate,
};

document.addEventListener("click", (event) => {
    const element = event.target.closest("[data-action]");
    if (!element) return;
    const [name, argument] = element.dataset.action.split(":");
    actions[name]?.(argument);
});

// --- Herramientas y guías --------------------------------------------------

function setTool(tool) {
    studio.tool = tool;
    for (const button of document.querySelectorAll("[data-tool]")) {
        button.setAttribute("aria-selected", button.dataset.tool === tool);
    }
    $("brush-options").classList.toggle("hidden", tool === "move");
    $("move-hint").classList.toggle("hidden", tool !== "move");
    $("eraser-hint").classList.toggle("hidden", tool !== "eraser");
    studio.overlay.style.cursor = tool === "move" ? "default" : "none";
    studio.renderOverlay();
}

for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
}

const BRUSH_FORMAT = {
    size: (v) => `${Math.round(v * 1000) / 10}%`,
    hardness: (v) => `${Math.round(v * 100)}%`,
    flow: (v) => `${Math.round(v * 100)}%`,
};

for (const key of ["color", "size", "hardness", "flow"]) {
    const input = $(`brush-${key}`);
    const output = document.querySelector(`output[for="brush-${key}"]`);
    const update = () => {
        studio.brush[key] = key === "color" ? input.value : parseFloat(input.value);
        if (output) output.textContent = BRUSH_FORMAT[key](studio.brush[key]);
        if (input.type === "range") syncRange(input);
    };
    input.addEventListener("input", update);
    update();
}

$("brush-symmetry").addEventListener("change", (event) => { studio.brush.symmetry = event.target.checked; });
$("guide-wireframe").addEventListener("change", (event) => { studio.showWireframe = event.target.checked; studio.renderOverlay(); });
$("guide-regions").addEventListener("change", (event) => { studio.showRegions = event.target.checked; studio.renderOverlay(); });
window.addEventListener("resize", () => studio.renderOverlay());

document.addEventListener("keydown", (event) => {

    if (event.target.closest("input, select, textarea") || document.querySelector("dialog[open]")) return;

    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    const step = event.shiftKey ? 0.01 : 0.001;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };

    if (mod && key === "z") actions.undo();
    else if (mod && key === "d") actions.duplicate();
    else if (!mod && (key === "delete" || key === "backspace")) actions.delete();
    else if (!mod && key === "v") setTool("move");
    else if (!mod && key === "b") setTool("brush");
    else if (!mod && key === "e") setTool("eraser");
    else if (arrows[key] && studio.nudge(...arrows[key])) { /* movido */ }
    else return;

    event.preventDefault();

});

// --- Lista de capas --------------------------------------------------------

const TYPE_ICONS = { image: "image", region: "palette", paint: "brush" };

function layerIcon(layer) {
    if (layer.photo) return "scan-face";
    if (layer.generator?.kind === "text") return "type";
    if (layer.generator) return "shapes";
    return TYPE_ICONS[layer.type];
}

function iconButton(icon, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.dataset.variant = "ghost";
    button.dataset.size = "icon-xs";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i data-lucide="${icon}"></i>`;
    button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
    return button;
}

function layerThumb(layer) {

    const thumb = document.createElement("span");
    thumb.className = "layer-thumb";
    const source = layer.type === "paint" ? layer.canvas
        : layer.type === "image" ? studio.imageOf(layer)
        : null;

    if (source) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 56;
        const ctx = canvas.getContext("2d");
        const scale = Math.min(56 / source.width, 56 / source.height);
        ctx.drawImage(source, (56 - source.width * scale) / 2, (56 - source.height * scale) / 2, source.width * scale, source.height * scale);
        canvas.style.width = canvas.style.height = "100%";
        thumb.append(canvas);
    } else {
        thumb.innerHTML = `<i data-lucide="${layerIcon(layer)}"></i>`;
        thumb.style.color = layer.color;
    }

    return thumb;

}

let listSignature = "";

function renderLayerList() {

    const signature = JSON.stringify([
        studio.selected?.id,
        studio.layers.map((l) => [l.id, l.name, l.visible, l.color, l.revision, l.generator?.text, l.generator?.color])
    ]);
    if (signature === listSignature) return;
    listSignature = signature;

    const list = $("layer-list");
    list.replaceChildren();
    $("layer-count").textContent = studio.layers.length;

    if (studio.layers.length === 0) {
        list.innerHTML = `
            <li class="empty-preview m-2">
                <i data-lucide="layers" class="size-5"></i>
                <span>Sin capas. Usa el botón <strong>+</strong> para añadir stickers, maquillaje o pintura.</span>
            </li>`;
        refreshIcons();
        return;
    }

    for (const layer of [...studio.layers].reverse()) {

        const item = document.createElement("li");
        item.className = "layer-item";
        item.classList.toggle("is-hidden", !layer.visible);
        item.setAttribute("aria-selected", layer === studio.selected);

        const name = document.createElement("span");
        name.className = "layer-name";
        name.textContent = layer.name;
        name.title = layer.name;

        const actionsBox = document.createElement("span");
        actionsBox.className = "layer-actions";
        actionsBox.append(
            iconButton("arrow-up", "Subir", () => studio.moveLayer(layer, 1)),
            iconButton("arrow-down", "Bajar", () => studio.moveLayer(layer, -1)),
            iconButton("copy", "Duplicar", () => studio.duplicateLayer(layer)),
            iconButton("trash-2", "Eliminar", () => studio.removeLayer(layer)),
        );

        item.append(
            iconButton(layer.visible ? "eye" : "eye-off", layer.visible ? "Ocultar" : "Mostrar", () => {
                layer.visible = !layer.visible;
                studio.changed();
            }),
            layerThumb(layer),
            name,
            actionsBox,
        );

        item.addEventListener("click", () => studio.select(layer));
        list.append(item);

    }

    refreshIcons();

}

// --- Propiedades -----------------------------------------------------------

const percent = (v) => `${Math.round(v * 100)}%`;

const prop = (key, label, type, extra = {}) => ({
    label, type,
    get: (layer) => layer[key],
    set: (layer, value) => { layer[key] = value; },
    ...extra
});

// Propiedad del generador (texto o color de un sticker generado): lo regenera.
const generatorProp = (key, label, type) => ({
    label, type,
    get: (layer) => layer.generator[key],
    set: (layer, value) => {
        layer.generator = { ...layer.generator, [key]: value };
        layer.source = generate(layer.generator);
    }
});

// Devuelve lo que se borro con el borrador (la imagen original se conserva).
const restoreErasedAction = {
    label: "Restaurar lo borrado", icon: "rotate-ccw", snapshot: false,
    run: (layer) => studio.clearMask(layer)
};

function fieldsFor(layer) {

    const fields = [
        prop("name", "Nombre", "text"),
        prop("opacity", "Opacidad", "range", { min: 0, max: 1, step: 0.01, format: percent }),
        prop("blend", "Mezcla con capas de abajo", "select", { options: BLEND_MODES }),
    ];

    if (layer.type === "image") {

        if (layer.generator) {
            fields.push({ type: "heading", label: layer.generator.kind === "text" ? "Texto" : "Forma" });
            if (layer.generator.kind === "text") fields.push(generatorProp("text", "Texto", "text"));
            fields.push(generatorProp("color", "Color", "color"));
        }

        fields.push(
            { type: "heading", label: "Transformación" },
            prop("x", "Posición X", "range", { min: 0, max: 1, step: 0.001, format: percent }),
            prop("y", "Posición Y", "range", { min: 0, max: 1, step: 0.001, format: percent }),
            prop("width", "Tamaño", "range", { min: 0.01, max: 1.5, step: 0.001, format: percent }),
            prop("rotation", "Rotación", "range", { min: -180, max: 180, step: 1, format: (v) => `${v}°` }),
            prop("mirror", "Espejo (en el otro lado de la cara)", "switch"),
            prop("flip", "Voltear horizontal", "switch"),
            { type: "actions", items: [
                { label: "Centrar", icon: "crosshair", run: (l) => Object.assign(l, { x: 0.5, y: 0.5 }) },
                { label: "Llenar lienzo", icon: "maximize", run: (l) => Object.assign(l, { x: 0.5, y: 0.5, width: 1, rotation: 0 }) },
                restoreErasedAction,
            ] },
        );

    } else if (layer.type === "region") {

        fields.push(
            { type: "heading", label: "Región" },
            prop("region", "Zona", "select", { options: Object.entries(FACE_REGIONS).map(([k, r]) => [k, r.label]) }),
            prop("color", "Color", "color"),
            prop("mode", "Modo", "select", { options: [["fill", "Relleno"], ["stroke", "Contorno"]] }),
            prop("lineWidth", "Grosor del contorno", "range", { min: 0.001, max: 0.03, step: 0.001, format: (v) => (v * 1000).toFixed(0) }),
            prop("blur", "Difuminado", "range", { min: 0, max: 0.03, step: 0.001, format: (v) => (v * 1000).toFixed(0) }),
            { type: "actions", items: [restoreErasedAction] },
        );

    } else if (layer.type === "paint") {

        fields.push({ type: "actions", items: [{
            label: "Borrar pintura", icon: "eraser", run: (l) => {
                const ctx = l.canvas.getContext("2d");
                const data = ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
                studio.pushUndo(() => ctx.putImageData(data, 0, 0));
                ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
                l.revision = (l.revision ?? 0) + 1;
            }
        }] });

    }

    return fields;

}

let propsLayer = null;
let propsInputs = [];

function setInputValue({ field, input, output }, layer) {
    const value = field.get(layer);
    if (field.type === "switch") input.checked = value;
    else input.value = value;
    if (field.type === "range") {
        syncRange(input);
        output.textContent = field.format(value);
    }
}

function createField(field, layer, id) {

    let input, output;

    if (field.type === "switch") {
        const label = document.createElement("label");
        label.className = "label gap-3";
        input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.className = "input";
        input.setAttribute("role", "switch");
        label.append(input, document.createTextNode(field.label));
        return { element: label, input };
    }

    const row = document.createElement("div");
    row.className = "field";
    if (field.type === "color") row.dataset.orientation = "horizontal";

    const label = document.createElement("label");
    label.className = "label";
    label.htmlFor = id;
    label.textContent = field.label;

    if (field.type === "select") {
        input = document.createElement("select");
        input.className = "select w-full";
        for (const [value, text] of field.options) input.add(new Option(text, value));
    } else {
        input = document.createElement("input");
        input.type = field.type;
        input.className = field.type === "color" ? "color-swatch" : "input";
        if (field.type === "range") Object.assign(input, { min: field.min, max: field.max, step: field.step });
    }
    input.id = id;

    if (field.type === "range") {
        const head = document.createElement("div");
        head.className = "flex justify-between";
        output = document.createElement("output");
        output.className = "range-value";
        head.append(label, output);
        row.append(head, input);
    } else {
        row.append(label, input);
    }

    return { element: row, input, output };

}

function renderProps() {

    const container = $("layer-props");
    const layer = studio.selected;

    if (layer && layer === propsLayer) {
        // Misma capa: solo sincroniza valores (p. ej. al arrastrar en el lienzo).
        for (const entry of propsInputs) {
            if (entry.input !== document.activeElement) setInputValue(entry, layer);
        }
        return;
    }

    propsLayer = layer;
    propsInputs = [];
    container.replaceChildren();

    if (!layer) {
        container.innerHTML = '<p class="text-sm text-muted-foreground">Selecciona una capa para editarla.</p>';
        return;
    }

    fieldsFor(layer).forEach((field, index) => {

        if (field.type === "heading") {
            const heading = document.createElement("h3");
            heading.className = "panel-title pt-2 border-t";
            heading.textContent = field.label;
            container.append(heading);
            return;
        }

        if (field.type === "actions") {
            const group = document.createElement("div");
            group.className = "flex flex-wrap gap-2";
            for (const action of field.items) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "btn";
                button.dataset.variant = "outline";
                button.dataset.size = "sm";
                button.innerHTML = `<i data-lucide="${action.icon}"></i><span></span>`;
                button.lastChild.textContent = action.label;
                button.addEventListener("click", () => {
                    if (action.snapshot !== false && layer.type !== "paint") studio.snapshot(layer);
                    action.run(layer);
                    studio.changed();
                });
                group.append(button);
            }
            container.append(group);
            return;
        }

        const { element, input, output } = createField(field, layer, `prop-${index}`);
        const entry = { field, input, output };
        setInputValue(entry, layer);

        // Deshacer: guarda el estado al empezar a editar y lo apila si cambio.
        let before = null;
        input.addEventListener("focus", () => { before = { ...layer }; });
        input.addEventListener("change", () => {
            if (before && Object.keys(before).some((key) => before[key] !== layer[key])) {
                const state = before;
                studio.pushUndo(() => Object.assign(layer, state));
            }
            before = { ...layer };
        });

        input.addEventListener("input", () => {
            const value = field.type === "switch" ? input.checked
                : field.type === "range" ? parseFloat(input.value)
                : input.value;
            field.set(layer, value);
            if (field.type === "range") {
                syncRange(input);
                output.textContent = field.format(value);
            }
            studio.changed();
        });

        container.append(element);
        propsInputs.push(entry);

    });

    refreshIcons();

}

function updateToolbar() {
    for (const action of ["duplicate", "delete"]) {
        document.querySelector(`[data-action="${action}"]`).disabled = !studio.selected;
    }
    document.querySelector('[data-action="undo"]').disabled = studio.undoStack.length === 0;
}

// --- Vista previa ----------------------------------------------------------

const previewCanvas = $("preview-canvas");
const previewCtx = previewCanvas.getContext("2d");
const previewVideo = $("preview-video");

let previewMode = "photo";
let previewTexture = null;
let previewQueued = false;

let webCamera = null;
let cameraTracker = null;

function getPreviewTexture() {
    if (!previewTexture) previewTexture = studio.exportCanvas(PREVIEW_TEXTURE_SIZE);
    return previewTexture;
}

function drawPreview(source, width, height, landmarks) {

    const scale = Math.min(1, PREVIEW_MAX_WIDTH / width);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    if (previewCanvas.width !== w || previewCanvas.height !== h) {
        previewCanvas.width = w;
        previewCanvas.height = h;
    }

    previewCtx.drawImage(source, 0, 0, w, h);
    if (landmarks) renderFaceTexture(previewCtx, getPreviewTexture(), landmarks, w, h);

}

function showPreview(visible) {
    previewCanvas.classList.toggle("hidden", !visible);
    $("preview-empty").classList.toggle("hidden", visible);
}

function requestPreview() {
    if (previewMode !== "photo" || previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => {
        previewQueued = false;
        if (!photo) return;
        drawPreview(photo.image, photo.image.naturalWidth, photo.image.naturalHeight, photo.landmarks);
    });
}

function cameraLoop() {
    if (previewMode !== "camera") return;
    cameraTracker.update();
    if (previewVideo.videoWidth) {
        drawPreview(previewVideo, previewVideo.videoWidth, previewVideo.videoHeight, cameraTracker.getLandmarks());
    }
    requestAnimationFrame(cameraLoop);
}

async function setPreviewMode(mode) {

    previewMode = mode;
    for (const button of document.querySelectorAll("[data-preview]")) {
        button.setAttribute("aria-selected", button.dataset.preview === mode);
    }
    previewCanvas.classList.toggle("mirrored", mode === "camera");

    if (mode === "camera") {
        try {
            setStatus("Iniciando cámara…", true);
            webCamera ??= new WebCamera(previewVideo);
            await webCamera.startCamera();
            if (!cameraTracker) {
                cameraTracker = new MPFaceTracker(previewVideo);
                await cameraTracker.init();
            }
            setStatus("");
            showPreview(true);
            cameraLoop();
        } catch (error) {
            console.error(error);
            setStatus("No se pudo abrir la cámara.");
            showPreview(false);
        }
        return;
    }

    webCamera?.stopCamera();
    showPreview(!!photo);
    requestPreview();

}

for (const button of document.querySelectorAll("[data-preview]")) {
    button.addEventListener("click", () => setPreviewMode(button.dataset.preview));
}

studio.onNotice = (message) => setStatus(message);

studio.onChange = () => {
    previewTexture = null;
    renderLayerList();
    renderProps();
    updateToolbar();
    requestPreview();
};

// --- Exportar --------------------------------------------------------------

const exportSize = () => parseInt($("export-size").value, 10);

function exportMask() {
    const mask = createFaceMask(studio.exportCanvas(exportSize()), { lit: $("mask-material").value === "lit" });
    const json = mask.toJSON();
    download(new Blob([JSON.stringify(json)], { type: "application/json" }), "mascara_facial.json");
    setStatus("Máscara exportada: impórtala en el editor con File → Import.");
}

function exportTemplate() {
    const size = exportSize();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const { showWireframe, showRegions } = studio;
    Object.assign(studio, { showWireframe: true, showRegions: true });
    studio.drawGuides(canvas.getContext("2d"), size);
    Object.assign(studio, { showWireframe, showRegions });
    downloadCanvas(canvas, "plantilla_uv.png");
}

setTool("move");
studio.onChange();
showPreview(false);
refreshIcons();

// Para depurar desde la consola.
window.studio = studio;
