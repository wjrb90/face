// Utilidades para trabajar en el espacio UV del modelo canonico de MediaPipe:
// desplegar una foto a UV, dibujar una textura sobre una cara detectada,
// y obtener las regiones de la cara (labios, ojos, cejas, ovalo) en UV.

import { FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
import { UVS, INDICES, VERTEX_COUNT } from "./canonical_face_model.js";

export { UVS, INDICES, VERTEX_COUNT };

// Coordenadas en un lienzo cuadrado de `size` px (fila 0 = arriba = v 1).
export function uvToCanvas(index, size) {
    return {
        x: UVS[index * 2] * size,
        y: (1 - UVS[index * 2 + 1]) * size
    };
}

// Dibuja el triangulo `src` de `image` sobre el triangulo `dst` del contexto
// (ambos como [x0, y0, x1, y1, x2, y2] en pixeles), con una transformacion afin.
// `expand` agranda un poco el recorte para que no se vean costuras.
export function drawTexturedTriangle(ctx, image, src, dst, expand = 0.6) {

    const [u0, v0, u1, v1, u2, v2] = src;
    const [x0, y0, x1, y1, x2, y2] = dst;

    const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
    const det = du1 * dv2 - du2 * dv1;

    if (Math.abs(det) < 1e-9)
        return;

    const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;

    const a = (dx1 * dv2 - dx2 * dv1) / det;
    const c = (dx2 * du1 - dx1 * du2) / det;
    const b = (dy1 * dv2 - dy2 * dv1) / det;
    const d = (dy2 * du1 - dy1 * du2) / det;
    const e = x0 - a * u0 - c * v0;
    const f = y0 - b * u0 - d * v0;

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;

    ctx.save();
    ctx.beginPath();

    for (let k = 0; k < 3; k++) {
        const x = dst[k * 2], y = dst[k * 2 + 1];
        const length = Math.hypot(x - cx, y - cy) || 1;
        const px = x + (x - cx) / length * expand;
        const py = y + (y - cy) / length * expand;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }

    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();

}

// Copia la cara de una foto al espacio UV. `landmarks` son los de FaceLandmarker
// (normalizados 0..1) detectados en `image`. Devuelve un canvas de size x size.
export function unwrapToUV(image, landmarks, size = 1024) {

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");

    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;

    for (let t = 0; t < INDICES.length; t += 3) {

        const src = [];
        const dst = [];

        for (let k = 0; k < 3; k++) {
            const i = INDICES[t + k];
            const uv = uvToCanvas(i, size);
            src.push(landmarks[i].x * width, landmarks[i].y * height);
            dst.push(uv.x, uv.y);
        }

        drawTexturedTriangle(ctx, image, src, dst);

    }

    return canvas;

}

// Dibuja `texture` (lienzo UV cuadrado) sobre la cara detectada en un lienzo de
// width x height. Descarta los triangulos de espaldas y pinta del fondo al frente.
export function renderFaceTexture(ctx, texture, landmarks, width, height) {

    if (!landmarks || landmarks.length < VERTEX_COUNT)
        return;

    const size = texture.width;
    const triangles = [];
    let positive = 0;

    for (let t = 0; t < INDICES.length; t += 3) {

        const a = landmarks[INDICES[t]];
        const b = landmarks[INDICES[t + 1]];
        const c = landmarks[INDICES[t + 2]];

        const area =
            (b.x - a.x) * (c.y - a.y) -
            (c.x - a.x) * (b.y - a.y);

        if (area > 0) positive++;

        triangles.push({ t, area, z: a.z + b.z + c.z });

    }

    // La mayoria de los triangulos visibles miran a la camara.
    const front = positive >= triangles.length / 2 ? 1 : -1;

    const visible = triangles
        .filter((tri) => tri.area * front > 0)
        .sort((p, q) => q.z - p.z);

    for (const { t } of visible) {

        const src = [];
        const dst = [];

        for (let k = 0; k < 3; k++) {
            const i = INDICES[t + k];
            const uv = uvToCanvas(i, size);
            src.push(uv.x, uv.y);
            dst.push(landmarks[i].x * width, landmarks[i].y * height);
        }

        drawTexturedTriangle(ctx, texture, src, dst);

    }

}

export function drawUVWireframe(ctx, size, color = "rgba(255, 255, 255, 0.35)", lineWidth = 1) {

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    for (let t = 0; t < INDICES.length; t += 3) {
        const a = uvToCanvas(INDICES[t], size);
        const b = uvToCanvas(INDICES[t + 1], size);
        const c = uvToCanvas(INDICES[t + 2], size);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
    }

    ctx.stroke();
    ctx.restore();

}

// --- Regiones -------------------------------------------------------------

// Une las conexiones de MediaPipe ({start, end}) en caminos de indices.
function chainEdges(connections) {

    const adjacency = new Map();

    for (const { start, end } of connections) {
        if (!adjacency.has(start)) adjacency.set(start, []);
        if (!adjacency.has(end)) adjacency.set(end, []);
        adjacency.get(start).push(end);
        adjacency.get(end).push(start);
    }

    const key = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
    const used = new Set();
    const paths = [];

    // Primero los extremos (grado 1) para recorrer bien los caminos abiertos.
    const starts = [...adjacency.keys()].sort(
        (a, b) => adjacency.get(a).length - adjacency.get(b).length
    );

    for (const first of starts) {
        for (const second of adjacency.get(first)) {

            if (used.has(key(first, second)))
                continue;

            used.add(key(first, second));
            const path = [first, second];
            let current = second;

            while (true) {
                const next = adjacency.get(current).find((n) => !used.has(key(current, n)));
                if (next === undefined) break;
                used.add(key(current, next));
                path.push(next);
                current = next;
            }

            paths.push(path);

        }
    }

    return paths;

}

// Une dos caminos abiertos (p. ej. borde superior e inferior de una ceja) en un poligono.
function joinOpenPaths(paths) {

    const closed = paths.filter((p) => p[0] === p[p.length - 1]);
    const open = paths.filter((p) => p[0] !== p[p.length - 1]);

    if (open.length !== 2)
        return paths;

    const [first, second] = open;
    const end = UVS.subarray(first[first.length - 1] * 2);
    const distance = (i) => Math.hypot(UVS[i * 2] - end[0], UVS[i * 2 + 1] - end[1]);

    const tail = distance(second[0]) < distance(second[second.length - 1])
        ? second
        : [...second].reverse();

    return [...closed, [...first, ...tail]];

}

function regionPaths(...connectionSets) {
    return connectionSets.flatMap((connections) => joinOpenPaths(chainEdges(connections)));
}

export const FACE_REGIONS = {
    lips: { label: "Labios", paths: () => regionPaths(FaceLandmarker.FACE_LANDMARKS_LIPS) },
    eyes: {
        label: "Ojos",
        paths: () => regionPaths(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE)
    },
    brows: {
        label: "Cejas",
        paths: () => regionPaths(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW)
    },
    face: {
        label: "Cara completa (sin ojos)",
        paths: () => regionPaths(
            FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
            FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE
        )
    },
};

const pathCache = new Map();

// Crea el trazado de la region en `ctx` (lienzo de size x size). Rellenar con "evenodd".
export function traceRegion(ctx, region, size) {

    if (!pathCache.has(region))
        pathCache.set(region, FACE_REGIONS[region].paths());

    ctx.beginPath();

    for (const path of pathCache.get(region)) {
        path.forEach((index, k) => {
            const p = uvToCanvas(index, size);
            if (k === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
    }

}
