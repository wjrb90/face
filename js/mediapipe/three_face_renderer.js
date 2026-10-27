import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js";
import { FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
import { GLTFExporter } from "https://cdn.jsdelivr.net/npm/three@0.181.1/examples/jsm/exporters/GLTFExporter.js";

const TRIANGULATION = (() => {

    const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;

    const adjacency = new Map();

    for (const edge of edges) {

        if (!adjacency.has(edge.start))
            adjacency.set(edge.start, new Set());

        if (!adjacency.has(edge.end))
            adjacency.set(edge.end, new Set());

        adjacency.get(edge.start).add(edge.end);
        adjacency.get(edge.end).add(edge.start);

    }

    const triangles = [];

    for (const [a, neighbors] of adjacency) {

        for (const b of neighbors) {

            if (b <= a)
                continue;

            const neighborsB = adjacency.get(b);

            for (const c of neighbors) {

                if (c <= b)
                    continue;

                if (neighborsB.has(c))
                    triangles.push(a, b, c);

            }

        }

    }

    return triangles;

})();

function orientTriangles(triangles, positions) {

    const triCount = triangles.length / 3;

    const tris = [];

    for (let t = 0; t < triCount; t++) {

        tris.push([
            triangles[t * 3],
            triangles[t * 3 + 1],
            triangles[t * 3 + 2]
        ]);

    }

    const edgeMap = new Map();

    const edgeKey = (a, b) => (a < b ? a + ":" + b : b + ":" + a);

    for (let t = 0; t < triCount; t++) {

        for (let k = 0; k < 3; k++) {

            const key = edgeKey(tris[t][k], tris[t][(k + 1) % 3]);

            if (!edgeMap.has(key))
                edgeMap.set(key, []);

            edgeMap.get(key).push(t);

        }

    }

    const oriented = tris.map(tri => tri.slice());

    const visited = new Uint8Array(triCount);
    const queue = [];

    for (let start = 0; start < triCount; start++) {

        if (visited[start])
            continue;

        visited[start] = 1;
        queue.push(start);

        while (queue.length > 0) {

            const t = queue.shift();

            for (let k = 0; k < 3; k++) {

                const v1 = oriented[t][k];
                const v2 = oriented[t][(k + 1) % 3];

                for (const s of edgeMap.get(edgeKey(v1, v2))) {

                    if (visited[s])
                        continue;

                    visited[s] = 1;

                    let p = -1;
                    let q = -1;

                    for (let m = 0; m < 3; m++) {

                        if (oriented[s][m] === v1)
                            p = m;

                        if (oriented[s][m] === v2)
                            q = m;

                    }

                    if (q === (p + 1) % 3) {

                        const tmp = oriented[s][(p + 1) % 3];
                        oriented[s][(p + 1) % 3] = oriented[s][(p + 2) % 3];
                        oriented[s][(p + 2) % 3] = tmp;

                    }

                    queue.push(s);

                }

            }

        }

    }

    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();

    let signedVolume = 0;

    for (let t = 0; t < triCount; t++) {

        va.set(
            positions[oriented[t][0]].x,
            positions[oriented[t][0]].y,
            positions[oriented[t][0]].z
        );

        vb.set(
            positions[oriented[t][1]].x,
            positions[oriented[t][1]].y,
            positions[oriented[t][1]].z
        );

        vc.set(
            positions[oriented[t][2]].x,
            positions[oriented[t][2]].y,
            positions[oriented[t][2]].z
        );

        signedVolume +=
            va.x * (vb.y * vc.z - vc.y * vb.z) -
            va.y * (vb.x * vc.z - vc.x * vb.z) +
            va.z * (vb.x * vc.y - vc.x * vb.y);

    }

    if (signedVolume < 0) {

        for (let t = 0; t < triCount; t++) {

            const tmp = oriented[t][1];
            oriented[t][1] = oriented[t][2];
            oriented[t][2] = tmp;

        }

    }

    const result = [];

    for (const tri of oriented)
        result.push(tri[0], tri[1], tri[2]);

    return result;

}

export default class ThreeFaceRenderer {

    constructor(video, threePlayer) {

        this.video = video;
        this.threePlayer = threePlayer;

        this.faceGroup = new THREE.Group();
        this.faceGroup.name = "ThreeFaceRenderer";

        this.mesh = null;
        this.connectors = null;
        this.contours = null;
        this.irises = null;
        this.points = null;
        this.nosePoint = null;
        this.landmarks = null;
        this.pivot = new THREE.Vector3();
        this.projectionDistance = 10;

        this.showHelpers = false;
        this.showMesh = true;
        this.showConnectors = true;
        this.showContours = true;
        this.showIrises = true;
        this.showPoints = true;        

        this.threePlayer.mainScene.add(this.faceGroup);

    }

    clear() {
        for (const child of this.faceGroup.children) {
            child.visible = false;
        }
    }

    drawMesh(landmarks) {

        if (!landmarks || landmarks.length === 0)
            return;

        if (!this.mesh) {

            const aspect =
                this.video.videoWidth / this.video.videoHeight;

            const mapped = landmarks.map(p => ({
                x: (p.x - 0.5) * aspect,
                y: -(p.y - 0.5),
                z: -p.z * aspect
            }));

            const geometry = new THREE.BufferGeometry();

            geometry.setAttribute(
                "position",
                new THREE.BufferAttribute(
                    new Float32Array(landmarks.length * 3),
                    3
                )
            );

            geometry.setAttribute(
                "uv",
                new THREE.BufferAttribute(
                    new Float32Array(landmarks.length * 2),
                    2
                )
            );

            geometry.setIndex(orientTriangles(TRIANGULATION, mapped));

            const material = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: 0.4,
                depthWrite: false,
                // side: THREE.DoubleSide
            });

            this.mesh = new THREE.Mesh(geometry, material);

            this.mesh.frustumCulled = false;

            this.faceGroup.add(this.mesh);

        }

        this.updatePositions(this.mesh, landmarks);
        this.mesh.visible = this.showMesh && this.showHelpers;

    }

    drawConnectors(landmarks) {

        if (!landmarks || landmarks.length === 0)
            return;

        if (!this.connectors) {

            this.connectors = this.buildLine(
                FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                0x00ff00,
                landmarks.length
            );

            this.faceGroup.add(this.connectors);

        }

        this.updatePositions(this.connectors, landmarks);
        this.connectors.visible = this.showConnectors && this.showHelpers;

    }

    drawContours(landmarks) {

        if (!landmarks || landmarks.length === 0)
            return;

        if (!this.contours) {

            this.contours = this.buildLine(
                FaceLandmarker.FACE_LANDMARKS_CONTOURS,
                0x00ffff,
                landmarks.length
            );

            this.faceGroup.add(this.contours);

        }

        this.updatePositions(this.contours, landmarks);
        this.contours.visible = this.showContours && this.showHelpers;

    }

    drawIrises(landmarks) {

        if (!landmarks || landmarks.length === 0)
            return;

        if (!this.irises) {

            this.irises = new THREE.Group();
            this.irises.name = "Irises";

            this.irises.add(this.buildLine(
                FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
                0xff0000,
                landmarks.length
            ));

            this.irises.add(this.buildLine(
                FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
                0xff0000,
                landmarks.length
            ));

            this.faceGroup.add(this.irises);

        }

        for (const line of this.irises.children) {

            this.updatePositions(line, landmarks);

        }

        this.irises.visible = this.showIrises && this.showHelpers;
    }

    drawPoints(landmarks, radius = 2) {

        if (!landmarks || landmarks.length === 0)
            return;

        if (!this.video.videoWidth || !this.video.videoHeight)
            return;

        if (!this.points) {

            this.points = new THREE.InstancedMesh(
                new THREE.SphereGeometry(1, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xe5fd09 }),
                landmarks.length
            );

            this.points.frustumCulled = false;

            this.faceGroup.add(this.points);

        }

        const worldRadius = radius / this.video.videoHeight;
        const aspect =
            this.video.videoWidth / this.video.videoHeight;

        const dummy = new THREE.Object3D();

        for (let i = 0; i < landmarks.length; i++) {

            const p = landmarks[i];

            dummy.position.set(
                (p.x - 0.5) * aspect,
                -(p.y - 0.5),
                -p.z * aspect
            );
            dummy.scale.setScalar(worldRadius);
            dummy.updateMatrix();

            this.points.setMatrixAt(i, dummy.matrix);

        }

        this.points.instanceMatrix.needsUpdate = true;
        this.points.visible = this.showPoints && this.showHelpers;
    }

    resize() {

        const container = this.threePlayer.container;
        const width = container.clientWidth;
        const height = container.clientHeight;

        const videoAspect =
            this.video.videoWidth / this.video.videoHeight;

        if (!width || !height || !Number.isFinite(videoAspect) || !videoAspect)
            return;

        const containerAspect = width / height;
        const distance = this.projectionDistance;

        const visibleHeight = Math.min(1, videoAspect / containerAspect);

        this.threePlayer.camera.position.set(0, 0, distance);
        this.threePlayer.camera.aspect = containerAspect;
        this.threePlayer.camera.fov =
            2 * Math.atan(visibleHeight / 2 / distance) * (180 / Math.PI);
        this.threePlayer.camera.updateProjectionMatrix();

    }

    alignCamera() { this.resize(); }

    getHeadPose() {

        const landmarks = this.landmarks;

        if (!landmarks || landmarks.length < 478)
            return null;

        const aspect =
            this.video.videoWidth / this.video.videoHeight;

        const point = (i) => {
            const lm = landmarks[i];
            return new THREE.Vector3(
                (lm.x - 0.5) * aspect,
                -(lm.y - 0.5),
                -lm.z * aspect
            );
        };

        const forehead = point(10);
        const chin = point(152);
        const leftEye = point(33);
        const rightEye = point(263);
        const leftCheek = point(234);
        const rightCheek = point(454);

        const position = new THREE.Vector3()
            .add(leftEye)
            .add(rightEye)
            .divideScalar(2);

        const up = new THREE.Vector3()
            .subVectors(forehead, chin)
            .normalize();

        const right = new THREE.Vector3()
            .subVectors(leftEye, rightEye)
            .normalize();

        const forward = new THREE.Vector3()
            .crossVectors(right, up)
            .normalize();

        const quaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(right, up, forward)
        );

        const scale = new THREE.Vector3()
            .subVectors(rightCheek, leftCheek)
            .length();

        return { position, quaternion, scale };

    }

    buildLine(connections, color, vertexCount) {

        const positions = new Float32Array(vertexCount * 3);

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3)
        );

        const indices = [];

        for (const edge of connections) {

            indices.push(edge.start, edge.end);

        }

        geometry.setIndex(indices);

        const line = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({ color })
        );

        line.frustumCulled = false;

        return line;

    }

    updatePositions(line, landmarks) {

        this.landmarks = landmarks;

        const aspect =
            this.video.videoWidth / this.video.videoHeight;

        const positions =
            line.geometry.attributes.position.array;

        for (let i = 0; i < landmarks.length; i++) {

            const p = landmarks[i];

            positions[i * 3 + 0] = (p.x - 0.5) * aspect;
            positions[i * 3 + 1] = -(p.y - 0.5);
            positions[i * 3 + 2] = -p.z * aspect;

        }

        const left = landmarks[234];
        const right = landmarks[454];

        if (left && right) {

            this.pivot.set(
                ((left.x - 0.5) * aspect + (right.x - 0.5) * aspect) / 2,
                (-(left.y - 0.5) + -(right.y - 0.5)) / 2,
                (-(left.z * aspect) + -(right.z * aspect)) / 2
            );

        }

        line.geometry.attributes.position.needsUpdate = true;

        const uvs = line.geometry.attributes.uv;

        if (uvs) {

            const cx = this.pivot.x;
            const cz = this.pivot.z;

            for (let i = 0; i < landmarks.length; i++) {

                const lx = (landmarks[i].x - 0.5) * aspect;
                const lz = -landmarks[i].z * aspect;

                uvs.array[i * 2 + 0] =
                    (Math.atan2(lx - cx, lz - cz) + Math.PI) / (2 * Math.PI);
                uvs.array[i * 2 + 1] = 1 - landmarks[i].y;

            }

            uvs.needsUpdate = true;

        }

    }

    buildNosePoint() {

        const geometry = new THREE.SphereGeometry(0.02, 16, 16);

        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000
        });

        this.nosePoint = new THREE.Mesh(geometry, material);

        this.faceGroup.add(this.nosePoint);

    }

    drawLandmark(landmark) {

        if (!landmark)
            return;

        if (!this.nosePoint)
            this.buildNosePoint();

        const aspect =
            this.video.videoWidth / this.video.videoHeight;

        this.nosePoint.position.set(
            (landmark.x - 0.5) * aspect,
            -(landmark.y - 0.5),
            -landmark.z * aspect
        );
    }

    exportMesh() {

        if (!this.mesh || !this.landmarks || this.landmarks.length === 0)
            return Promise.resolve(null);

        const exporter = new GLTFExporter();

        const geometry = this.mesh.geometry.clone();
        const pivot = this.pivot;

        const position = geometry.attributes.position;
        const count = position.count;

        for (let i = 0; i < count; i++) {

            position.array[i * 3 + 0] -= pivot.x;
            position.array[i * 3 + 1] -= pivot.y;
            position.array[i * 3 + 2] -= pivot.z;

        }

        position.needsUpdate = true;

        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, this.mesh.material);

        return new Promise((resolve, reject) => {

            exporter.parse(
                mesh,
                (gltf) => {

                    const blob = new Blob(
                        [gltf],
                        { type: "model/gltf-binary" }
                    );

                    resolve({
                        arrayBuffer: gltf,
                        blob: blob,
                        url: URL.createObjectURL(blob)
                    });
                    
                },
                (error) => reject(error),
                { binary: true }
            );
            
        });

    }

    async downloadMesh(filename = "face.glb") {

        const result = await this.exportMesh();

        if (!result)
            return;

        const link = document.createElement("a");
        link.href = result.url;
        link.download = filename;
        link.click();

    }

    exportAndDownloadMesh(filename = "face.glb") {

        this.exportMesh().then((result) => {

            if (!result)
                return;

            const link = document.createElement("a");
            link.href = result.url;
            link.download = filename;
            link.click();

        }).catch((error) => {

            console.error("Error exporting mesh:", error);

        });

    }

    syncFaceMesh(mesh) {

        if (!mesh || !this.landmarks || this.landmarks.length === 0)
            return;

        const aspect =
            this.video.videoWidth / this.video.videoHeight;

        const positions = mesh.geometry.attributes.position.array;

        const count = Math.min(
            this.landmarks.length,
            mesh.geometry.attributes.position.count
        );

        for (let i = 0; i < count; i++) {

            const p = this.landmarks[i];

            positions[i * 3 + 0] = (p.x - 0.5) * aspect - this.pivot.x;
            positions[i * 3 + 1] = -(p.y - 0.5) - this.pivot.y;
            positions[i * 3 + 2] = -p.z * aspect - this.pivot.z;

        }

        mesh.geometry.attributes.position.needsUpdate = true;

        if (mesh.geometry.attributes.normal) {

            mesh.geometry.computeVertexNormals();
            mesh.geometry.attributes.normal.needsUpdate = true;

        }

        if (mesh.geometry.boundingSphere) {

            mesh.geometry.computeBoundingSphere();

        }

        mesh.position.copy(this.pivot);
        mesh.quaternion.identity();
        mesh.scale.setScalar(1);

    }

}
