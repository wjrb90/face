// Editor de capas para pintar texturas sobre el mapa UV canonico de MediaPipe.
// Las posiciones de las capas se guardan normalizadas (0..1), asi la misma
// composicion se puede exportar a cualquier resolucion.
//
// `canvas` muestra la textura; `overlay` (encima) muestra guias, controles de
// transformacion y el cursor del pincel, y recibe los eventos del raton.

import { drawUVWireframe, traceRegion } from "../mediapipe/face_uv.js";

const PAINT_SIZE = 1024;
const MASK_MAX_SIZE = 1024;
const MAX_UNDO = 30;

// Tamaños de los controles en pixeles de pantalla.
const HANDLE_SIZE = 10;
const ROTATE_OFFSET = 28;
const SNAP_DEGREES = 15;

const ACCENT = "#3b82f6";

let nextId = 1;

export default class TextureStudio {

    constructor(canvas, overlay) {

        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.overlay = overlay;
        this.overlayCtx = overlay.getContext("2d");
        this.size = canvas.width;

        this.layers = [];
        this.selected = null;

        this.showWireframe = true;
        this.showRegions = false;

        this.tool = "move";
        this.brush = { color: "#d6336c", size: 0.02, hardness: 0.3, flow: 0.4, symmetry: true };

        this.undoStack = [];
        this.drag = null;
        this.hover = null;
        this.onChange = () => {};
        this.onNotice = () => {};

        overlay.addEventListener("pointerdown", (e) => this.pointerDown(e));
        overlay.addEventListener("pointermove", (e) => this.pointerMove(e));
        overlay.addEventListener("pointerup", (e) => this.pointerUp(e));
        overlay.addEventListener("pointercancel", (e) => this.pointerUp(e));
        overlay.addEventListener("pointerleave", () => { this.hover = null; this.renderOverlay(); });
        overlay.addEventListener("wheel", (e) => this.wheel(e), { passive: false });

        this.render();

    }

    // --- Capas -------------------------------------------------------------

    addLayer(layer) {
        layer = {
            id: nextId++,
            visible: true,
            opacity: 1,
            blend: "source-over",
            ...layer
        };
        this.layers.push(layer);
        this.selected = layer;
        this.pushUndo(() => this.removeLayer(layer, false));
        this.changed();
        return layer;
    }

    // `source` es una imagen o canvas. width es el ancho relativo al lienzo.
    addImageLayer(source, options = {}) {
        return this.addLayer({
            type: "image",
            name: "Imagen",
            source,
            x: 0.5,
            y: 0.5,
            width: 0.25,
            rotation: 0,
            flip: false,
            mirror: false,
            ...options
        });
    }

    addRegionLayer(region, options = {}) {
        return this.addLayer({
            type: "region",
            name: "Region",
            region,
            color: "#d6336c",
            mode: "fill",
            lineWidth: 0.006,
            blur: 0.004,
            ...options
        });
    }

    addPaintLayer(options = {}) {
        return this.addLayer({ type: "paint", name: "Pintura", canvas: createPaintCanvas(), ...options });
    }

    duplicateLayer(layer) {

        const copy = { ...layer, id: nextId++, name: `${layer.name} (copia)` };

        if (layer.type === "paint") {
            copy.canvas = createPaintCanvas();
            copy.canvas.getContext("2d").drawImage(layer.canvas, 0, 0);
        }

        if (layer.mask) {
            copy.mask = cloneCanvas(layer.mask);
            copy.maskedImage = null;
        }

        if (layer.type === "image") {
            copy.x = Math.min(1, layer.x + 0.03);
            copy.y = Math.min(1, layer.y + 0.03);
        }

        this.layers.splice(this.layers.indexOf(layer) + 1, 0, copy);
        this.selected = copy;
        this.pushUndo(() => this.removeLayer(copy, false));
        this.changed();
        return copy;

    }

    removeLayer(layer, undoable = true) {

        const index = this.layers.indexOf(layer);
        if (index < 0) return;

        this.layers.splice(index, 1);
        if (this.selected === layer) this.selected = null;

        if (undoable) {
            this.pushUndo(() => {
                this.layers.splice(index, 0, layer);
                this.selected = layer;
            });
        }

        this.changed();

    }

    // direction +1 sube la capa (se dibuja encima), -1 la baja.
    moveLayer(layer, direction) {
        const from = this.layers.indexOf(layer);
        const to = from + direction;
        if (to < 0 || to >= this.layers.length) return;
        this.layers.splice(from, 1);
        this.layers.splice(to, 0, layer);
        this.pushUndo(() => this.moveLayer(layer, -direction));
        this.changed();
    }

    select(layer) {
        this.selected = layer;
        this.changed();
    }

    changed() {
        this.render();
        this.onChange();
    }

    // --- Deshacer ----------------------------------------------------------

    pushUndo(restore) {
        this.undoStack.push(restore);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }

    // Guarda el estado de las propiedades de una capa (posicion, color, ...).
    snapshot(layer) {
        const state = { ...layer };
        this.pushUndo(() => Object.assign(layer, state));
    }

    undo() {
        const restore = this.undoStack.pop();
        if (!restore) return;
        // Las acciones de deshacer no deben apilar nuevos pasos.
        const stack = this.undoStack;
        this.undoStack = [];
        restore();
        this.undoStack = stack;
        this.changed();
    }

    // --- Dibujo ------------------------------------------------------------

    drawLayer(ctx, layer, size) {

        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend;

        if (layer.type === "image") {

            this.drawImageLayer(ctx, layer, size, false);
            if (layer.mirror) this.drawImageLayer(ctx, layer, size, true);

        } else if (layer.type === "region") {

            if (layer.mask) {
                // Se dibuja aparte para poder quitarle lo borrado antes de mezclarla.
                const temp = document.createElement("canvas");
                temp.width = temp.height = size;
                const tempCtx = temp.getContext("2d");
                this.drawRegion(tempCtx, layer, size);
                tempCtx.globalCompositeOperation = "destination-out";
                tempCtx.drawImage(layer.mask, 0, 0, size, size);
                ctx.drawImage(temp, 0, 0);
            } else {
                this.drawRegion(ctx, layer, size);
            }

        } else if (layer.type === "paint") {

            ctx.drawImage(layer.canvas, 0, 0, size, size);

        }

        ctx.restore();

    }

    drawRegion(ctx, layer, size) {

        ctx.save();
        if (layer.blur > 0) ctx.filter = `blur(${layer.blur * size}px)`;
        traceRegion(ctx, layer.region, size);

        if (layer.mode === "stroke") {
            ctx.strokeStyle = layer.color;
            ctx.lineWidth = layer.lineWidth * size;
            ctx.lineJoin = "round";
            ctx.stroke();
        } else {
            ctx.fillStyle = layer.color;
            ctx.fill("evenodd");
        }

        ctx.restore();

    }

    drawImageLayer(ctx, layer, size, mirrored) {

        const image = this.imageOf(layer);
        const width = layer.width * size;
        const height = width * (image.height / image.width);

        ctx.save();
        ctx.translate((mirrored ? 1 - layer.x : layer.x) * size, layer.y * size);
        ctx.rotate((mirrored ? -1 : 1) * layer.rotation * Math.PI / 180);
        ctx.scale((layer.flip !== mirrored) ? -1 : 1, 1);
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
        ctx.restore();

    }

    // --- Mascara de borrado ------------------------------------------------
    // Lo que se borra de un sticker o una region se guarda en `layer.mask`
    // (pixeles opacos = borrado), asi la imagen original no se pierde y
    // "Restaurar lo borrado" la devuelve tal cual.

    // Imagen de la capa con lo borrado ya quitado (se recalcula solo si cambia).
    imageOf(layer) {

        if (!layer.mask) return layer.source;

        if (layer.maskDirty || !layer.maskedImage || layer.maskedSource !== layer.source) {
            const canvas = layer.maskedImage ?? document.createElement("canvas");
            canvas.width = layer.source.width;
            canvas.height = layer.source.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(layer.source, 0, 0);
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(layer.mask, 0, 0, canvas.width, canvas.height);
            layer.maskedImage = canvas;
            layer.maskedSource = layer.source;
            layer.maskDirty = false;
        }

        return layer.maskedImage;

    }

    // Crea la mascara si no existe: del tamaño de la imagen (max. 1024 px) o del lienzo.
    maskOf(layer) {

        if (!layer.mask) {
            const canvas = document.createElement("canvas");
            if (layer.type === "image") {
                const scale = Math.min(1, MASK_MAX_SIZE / Math.max(layer.source.width, layer.source.height));
                canvas.width = Math.max(1, Math.round(layer.source.width * scale));
                canvas.height = Math.max(1, Math.round(layer.source.height * scale));
            } else {
                canvas.width = canvas.height = MASK_MAX_SIZE;
            }
            layer.mask = canvas;
        }

        return layer.mask;

    }

    clearMask(layer) {

        if (!layer.mask) return;

        const mask = layer.mask;
        this.pushUndo(() => { layer.mask = mask; layer.maskDirty = true; });
        layer.mask = null;
        layer.maskedImage = null;
        layer.revision = (layer.revision ?? 0) + 1;
        this.changed();

    }

    // Punto del lienzo (0..1) -> pixeles de la mascara de una imagen, en la
    // copia normal y en la copia espejo (deshace posicion, giro y volteo).
    imageMaskPoints(layer, x, y, mask) {

        const halfW = layer.width / 2;
        const halfH = halfW * (layer.source.height / layer.source.width);

        return (layer.mirror ? [false, true] : [false]).map((mirrored) => {
            const angle = (mirrored ? -1 : 1) * layer.rotation * Math.PI / 180;
            const dx = x - (mirrored ? 1 - layer.x : layer.x);
            const dy = y - layer.y;
            let lx = dx * Math.cos(angle) + dy * Math.sin(angle);
            const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);
            if (layer.flip !== mirrored) lx = -lx;
            return {
                x: (lx + halfW) / (2 * halfW) * mask.width,
                y: (ly + halfH) / (2 * halfH) * mask.height
            };
        });

    }

    // Composicion final (lo que se exporta).
    compose(ctx, size) {
        for (const layer of this.layers) {
            if (layer.visible) this.drawLayer(ctx, layer, size);
        }
    }

    exportCanvas(size = 1024) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        this.compose(canvas.getContext("2d"), size);
        return canvas;
    }

    // Lineas de guia (malla UV y regiones), sin la textura.
    drawGuides(ctx, size) {

        if (this.showWireframe)
            drawUVWireframe(ctx, size, "rgba(160, 160, 170, 0.45)", Math.max(1, size / 1024));

        if (this.showRegions) {
            ctx.save();
            ctx.strokeStyle = "#22d3ee";
            ctx.lineWidth = 2 * size / 1024;
            for (const region of ["face", "lips", "brows"]) {
                traceRegion(ctx, region, size);
                ctx.stroke();
            }
            ctx.restore();
        }

    }

    render() {
        this.ctx.clearRect(0, 0, this.size, this.size);
        this.compose(this.ctx, this.size);
        this.renderOverlay();
    }

    // Pixeles del lienzo por pixel de pantalla.
    pixelRatio() {
        const width = this.overlay.getBoundingClientRect().width;
        return width ? this.size / width : 1;
    }

    renderOverlay() {

        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, this.size, this.size);
        this.drawGuides(ctx, this.size);

        const layer = this.selected;
        if (layer?.type === "image" && layer.visible) {
            if (layer.mirror) this.drawSelection(ctx, layer, true);
            this.drawSelection(ctx, layer, false);
        }

        if (this.hover && this.tool !== "move") {
            const ratio = this.pixelRatio();
            ctx.save();
            ctx.lineWidth = ratio;
            for (const x of this.brush.symmetry ? [this.hover.x, 1 - this.hover.x] : [this.hover.x]) {
                ctx.beginPath();
                ctx.arc(x * this.size, this.hover.y * this.size, this.brush.size * this.size, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
                ctx.stroke();
                ctx.setLineDash([4 * ratio, 4 * ratio]);
                ctx.strokeStyle = "#ffffff";
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        }

    }

    drawSelection(ctx, layer, mirrored) {

        const ratio = this.pixelRatio();
        const toPx = (p) => ({ x: p.x * this.size, y: p.y * this.size });
        const corners = this.imageCorners(layer, mirrored).map(toPx);

        ctx.save();
        ctx.lineWidth = 1.5 * ratio;
        ctx.strokeStyle = ACCENT;
        ctx.setLineDash(mirrored ? [6 * ratio, 4 * ratio] : []);
        ctx.beginPath();
        corners.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        if (!mirrored && this.tool === "move") {

            const handles = this.handles(layer);
            const rotate = toPx(handles.rotate);
            const top = toPx(handles.top);

            ctx.beginPath();
            ctx.moveTo(top.x, top.y);
            ctx.lineTo(rotate.x, rotate.y);
            ctx.stroke();

            ctx.fillStyle = "#ffffff";
            const half = HANDLE_SIZE / 2 * ratio;

            for (const corner of corners) {
                ctx.fillRect(corner.x - half, corner.y - half, half * 2, half * 2);
                ctx.strokeRect(corner.x - half, corner.y - half, half * 2, half * 2);
            }

            ctx.beginPath();
            ctx.arc(rotate.x, rotate.y, half * 1.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

        }

        ctx.restore();

    }

    // Esquinas de una capa de imagen en coordenadas normalizadas
    // (arriba-izq, arriba-der, abajo-der, abajo-izq).
    imageCorners(layer, mirrored = false) {

        const halfW = layer.width / 2;
        const halfH = halfW * (layer.source.height / layer.source.width);
        const angle = (mirrored ? -1 : 1) * layer.rotation * Math.PI / 180;
        const cx = mirrored ? 1 - layer.x : layer.x;
        const cos = Math.cos(angle), sin = Math.sin(angle);

        return [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]].map(([x, y]) => ({
            x: cx + x * cos - y * sin,
            y: layer.y + x * sin + y * cos
        }));

    }

    // Posicion de los controles: esquinas, centro del borde superior y rotacion.
    handles(layer) {

        const corners = this.imageCorners(layer);
        const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const dx = top.x - layer.x, dy = top.y - layer.y;
        const length = Math.hypot(dx, dy) || 1;
        const offset = ROTATE_OFFSET * this.pixelRatio() / this.size;

        return {
            corners,
            top,
            rotate: { x: top.x + dx / length * offset, y: top.y + dy / length * offset }
        };

    }

    // Que control de la capa seleccionada hay bajo el punto: "rotate", "scale-N" o null.
    handleAt(x, y) {

        const layer = this.selected;
        if (layer?.type !== "image" || !layer.visible) return null;

        const radius = HANDLE_SIZE * this.pixelRatio() / this.size;
        const near = (p) => Math.hypot(p.x - x, p.y - y) <= radius;
        const handles = this.handles(layer);

        if (near(handles.rotate)) return "rotate";

        const corner = handles.corners.findIndex(near);
        return corner >= 0 ? `scale-${corner}` : null;

    }

    // Devuelve { layer, mirrored } de la imagen visible mas alta bajo el punto.
    hitTest(x, y) {

        for (let i = this.layers.length - 1; i >= 0; i--) {

            const layer = this.layers[i];
            if (layer.type !== "image" || !layer.visible) continue;

            for (const mirrored of layer.mirror ? [false, true] : [false]) {

                const angle = (mirrored ? -1 : 1) * layer.rotation * Math.PI / 180;
                const dx = x - (mirrored ? 1 - layer.x : layer.x);
                const dy = y - layer.y;
                const lx = dx * Math.cos(angle) + dy * Math.sin(angle);
                const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);
                const halfW = layer.width / 2;
                const halfH = halfW * (layer.source.height / layer.source.width);

                if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH)
                    return { layer, mirrored };

            }

        }

        return null;

    }

    // --- Pintura -----------------------------------------------------------

    paintLayer() {
        if (this.selected?.type === "paint") return this.selected;
        return this.addPaintLayer();
    }

    // Donde pinta el trazo:
    //   pincel   -> capa de pintura (la seleccionada o una nueva)
    //   borrador -> la capa seleccionada: pintura, o la mascara de borrado
    //               de un sticker o una region
    strokeTarget() {

        if (this.tool === "brush") {
            const layer = this.paintLayer();
            return { layer, canvas: layer.canvas, mode: "paint" };
        }

        const layer = this.selected;
        if (!layer || !layer.visible) return null;
        if (layer.type === "paint") return { layer, canvas: layer.canvas, mode: "erase-paint" };
        return { layer, canvas: this.maskOf(layer), mode: "mask" };

    }

    dab(target, x, y) {

        const { layer, canvas, mode } = target;
        const ctx = canvas.getContext("2d");
        const xs = this.brush.symmetry ? [x, 1 - x] : [x];

        let points, radius;

        if (mode === "mask" && layer.type === "image") {
            points = xs.flatMap((px) => this.imageMaskPoints(layer, px, y, canvas));
            radius = this.brush.size / layer.width * canvas.width;
        } else {
            points = xs.map((px) => ({ x: px * canvas.width, y: y * canvas.height }));
            radius = this.brush.size * canvas.width;
        }

        // En la mascara, pintar = borrar; en la pintura, el borrador quita pixeles.
        const color = mode === "paint" ? this.brush.color : "#000000";

        ctx.save();
        ctx.globalCompositeOperation = mode === "erase-paint" ? "destination-out" : "source-over";

        for (const { x: cx, y: cy } of points) {

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, hexToRgba(color, this.brush.flow));
            gradient.addColorStop(Math.min(this.brush.hardness, 0.99), hexToRgba(color, this.brush.flow));
            gradient.addColorStop(1, hexToRgba(color, 0));

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();

        }

        ctx.restore();

        if (mode === "mask") layer.maskDirty = true;

    }

    strokeTo(x, y) {

        const { last, target } = this.drag;
        const step = Math.max(this.brush.size * 0.25, 0.001);
        const distance = Math.hypot(x - last.x, y - last.y);
        const count = Math.floor(distance / step);

        for (let k = 1; k <= count; k++) {
            const t = k / count;
            this.dab(target, last.x + (x - last.x) * t, last.y + (y - last.y) * t);
        }

        if (count > 0) this.drag.last = { x, y };

    }

    // --- Raton -------------------------------------------------------------

    toLocal(event) {
        const rect = this.overlay.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
        };
    }

    pointerDown(event) {

        if (event.button !== 0) return;

        const p = this.toLocal(event);
        this.overlay.setPointerCapture(event.pointerId);

        if (this.tool !== "move") {

            const target = this.strokeTarget();

            if (!target) {
                this.onNotice("Selecciona la capa que quieres borrar.");
                return;
            }

            const { layer, canvas } = target;
            const ctx = canvas.getContext("2d");
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            this.pushUndo(() => {
                ctx.putImageData(data, 0, 0);
                layer.maskDirty = true;
            });

            this.drag = { mode: "paint", layer, target, last: p };
            this.dab(target, p.x, p.y);
            this.render();
            return;

        }

        const handle = this.handleAt(p.x, p.y);
        const layer = this.selected;

        if (handle === "rotate") {
            this.drag = {
                mode: "rotate",
                before: { ...layer },
                layer,
                startAngle: Math.atan2(p.y - layer.y, p.x - layer.x),
                startRotation: layer.rotation
            };
            return;
        }

        if (handle) {
            this.drag = {
                mode: "scale",
                before: { ...layer },
                layer,
                startWidth: layer.width,
                startDistance: Math.hypot(p.x - layer.x, p.y - layer.y) || 1e-6
            };
            return;
        }

        const hit = this.hitTest(p.x, p.y);

        if (hit) {
            this.selected = hit.layer;
            this.drag = { mode: "move", layer: hit.layer, before: { ...hit.layer }, mirrored: hit.mirrored, last: p };
        } else if (this.selected?.type === "image") {
            this.selected = null;
        }

        this.changed();

    }

    pointerMove(event) {

        const p = this.toLocal(event);

        if (!this.drag) {
            this.hover = p;
            this.updateCursor(p);
            this.renderOverlay();
            return;
        }

        const { layer } = this.drag;

        if (this.drag.mode === "move") {

            const { mirrored, last } = this.drag;
            layer.x += (mirrored ? -1 : 1) * (p.x - last.x);
            layer.y += p.y - last.y;
            this.drag.last = p;
            this.changed();

        } else if (this.drag.mode === "scale") {

            const distance = Math.hypot(p.x - layer.x, p.y - layer.y);
            layer.width = clamp(this.drag.startWidth * distance / this.drag.startDistance, 0.01, 3);
            this.changed();

        } else if (this.drag.mode === "rotate") {

            const angle = Math.atan2(p.y - layer.y, p.x - layer.x);
            let rotation = this.drag.startRotation + (angle - this.drag.startAngle) * 180 / Math.PI;
            if (event.shiftKey) rotation = Math.round(rotation / SNAP_DEGREES) * SNAP_DEGREES;
            layer.rotation = Math.round(((rotation + 540) % 360) - 180);
            this.changed();

        } else {

            this.hover = p;
            this.strokeTo(p.x, p.y);
            this.render();

        }

    }

    pointerUp() {

        const drag = this.drag;
        this.drag = null;
        if (!drag) return;

        if (drag.mode === "paint") {
            drag.layer.revision = (drag.layer.revision ?? 0) + 1;
        } else {
            // Solo se guarda un paso de deshacer si la capa cambio de verdad.
            const { layer, before } = drag;
            if (["x", "y", "width", "rotation"].some((key) => layer[key] !== before[key])) {
                this.pushUndo(() => Object.assign(layer, before));
            }
        }

        this.onChange();

    }

    updateCursor(p) {

        if (this.tool !== "move") {
            this.overlay.style.cursor = "none";
            return;
        }

        const handle = this.handleAt(p.x, p.y);

        if (handle === "rotate") this.overlay.style.cursor = "grab";
        else if (handle) this.overlay.style.cursor = handle === "scale-0" || handle === "scale-2" ? "nwse-resize" : "nesw-resize";
        else this.overlay.style.cursor = this.hitTest(p.x, p.y) ? "move" : "default";

    }

    // Rueda: escala la imagen seleccionada; con Shift la rota.
    wheel(event) {

        const layer = this.selected;
        if (this.tool !== "move" || layer?.type !== "image") return;

        event.preventDefault();
        const direction = Math.sign(event.deltaY);

        if (event.shiftKey) layer.rotation = (layer.rotation + direction * 5 + 540) % 360 - 180;
        else layer.width = clamp(layer.width * (direction > 0 ? 0.95 : 1.05), 0.01, 3);

        this.changed();

    }

    // Mueve la imagen seleccionada con el teclado.
    nudge(dx, dy) {
        const layer = this.selected;
        if (layer?.type !== "image") return false;
        layer.x += dx;
        layer.y += dy;
        this.changed();
        return true;
    }

}

function cloneCanvas(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return canvas;
}

function createPaintCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PAINT_SIZE;
    return canvas;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function hexToRgba(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
