// Mascara facial canonica (mesh_0) lista para el editor de three.js.
//
// La web coloca la escena en el "ancla de la cabeza" que calcula
// ThreeFaceRenderer.getHeadPose():
//   - origen: punto medio entre los ojos (landmarks 33 y 263)
//   - 1 unidad: distancia entre las mejillas (landmarks 234 y 454)
//   - +Y hacia la frente, +Z hacia la camara (de frente)
// La mascara se exporta con esa misma convencion, asi lo que se coloca junto
// a ella en el editor (gafas, esferas, ...) aparece en el mismo sitio en la web.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js";
import { POSITIONS, UVS, INDICES } from "./canonical_face_model.js";

export const HEAD_LANDMARKS = { leftEye: 33, rightEye: 263, leftCheek: 234, rightCheek: 454 };

function canonicalPoint(index) {
    return new THREE.Vector3(POSITIONS[index * 3], POSITIONS[index * 3 + 1], POSITIONS[index * 3 + 2]);
}

// Posiciones del modelo canonico expresadas en el ancla de la cabeza.
export function headAnchoredPositions() {

    const origin = canonicalPoint(HEAD_LANDMARKS.leftEye)
        .add(canonicalPoint(HEAD_LANDMARKS.rightEye))
        .multiplyScalar(0.5);

    const unit = canonicalPoint(HEAD_LANDMARKS.leftCheek)
        .distanceTo(canonicalPoint(HEAD_LANDMARKS.rightCheek));

    return POSITIONS.map((value, k) => (value - origin.getComponent(k % 3)) / unit);

}

// Posicion de un landmark en el ancla de la cabeza (util para colocar objetos).
export function headAnchoredLandmark(index) {
    const positions = headAnchoredPositions();
    return new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
}

// `texture` es un canvas o imagen con la textura UV. lit = false usa un
// material sin luz (colores exactos, recomendado para maquillaje).
export function createFaceMask(texture, { lit = true } = {}) {

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(headAnchoredPositions(), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(UVS.slice(), 2));
    geometry.setIndex(Array.from(INDICES));
    geometry.computeVertexNormals();

    const map = new THREE.CanvasTexture(texture);
    map.colorSpace = THREE.SRGBColorSpace;
    map.name = "textura_facial";

    const material = lit
        ? new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.9, metalness: 0 })
        : new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false });
    material.name = "mascara_facial";

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "mesh_0";

    return mesh;

}
