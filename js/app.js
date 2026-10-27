import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js";
import { FACE_EVENT_TYPES } from "./mediapipe/face_events.js";
window.THREE = THREE;

// Eventos del Player del editor de three.js + eventos faciales de FaceEvents.
const EDITOR_EVENT_TYPES = [
    "init", "start", "stop", "update",
    "keydown", "keyup", "pointerdown", "pointerup", "pointermove"
];
const SCRIPT_EVENT_TYPES = [...EDITOR_EVENT_TYPES, ...FACE_EVENT_TYPES];

// Mismo formato que el editor: cada script recibe estas variables y define
// funciones con el nombre del evento. `this` es el objeto que tiene el script.
const SCRIPT_PARAMS = ["player", "renderer", "scene", "camera", "face", "THREE", ...SCRIPT_EVENT_TYPES].join(",");
const SCRIPT_RESULT = "{" + SCRIPT_EVENT_TYPES.join(",") + "}";

const INPUT_EVENT_TYPES = ["keydown", "keyup", "pointerdown", "pointerup", "pointermove"];

export default class ThreePlayer {
    constructor(container, renderer = null, scene = null, camera = null) {
        this.container = container;
        this.clock = new THREE.Clock();
        this.time = 0;
        this.loader = new THREE.ObjectLoader();
        this.loadedScene = null;
        this.rootNode = null;
        this.mainScene = null;
        this.instanceScene = null;

        // Estado facial (FaceEvents) disponible en los scripts como `face`.
        this.face = null;
        this.scriptEvents = {};
        this.onInputEvent = (event) => this.dispatch(event.type, event);

        if (renderer) { this.renderer = renderer; }
        else { this.createRenderer(); }

        if (scene) { this.mainScene = scene; }
        else { this.mainScene = new THREE.Scene(); }

        if (this.mainScene) {
            this.rootNode = new THREE.Group();
            this.rootNode.name  = 'RootNode';
            this.mainScene.add(this.rootNode);
        }

        if (camera) { this.camera = camera; }
        else {
            const width = this.container.clientWidth;
            const height = this.container.clientHeight;
            this.camera = new THREE.PerspectiveCamera(
                52,
                width / height,
                0.01,
                100
            );
            this.camera.position.set(0, 0, 5);
        }
    }

    createRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);

        Object.assign(this.renderer.domElement.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            objectFit: "cover",
            transform: "scaleX(-1)"
        });

        this.container.appendChild(this.renderer.domElement);
    }

    async loadProject(url, onProgress) {
        return new Promise((resolve, reject) => {
            const fileLoader = new THREE.FileLoader();
            fileLoader.load(
                url,
                (text) => {
                    try {
                        const json = JSON.parse(text);
                        const sceneJson = json.scene || json;
                        const parsed = this.loader.parse(sceneJson);

                        this.stop();

                        // Sin clonar: los scripts del editor se asocian por uuid.
                        this.instanceScene = parsed;
                        this.loadedScene = parsed;

                        this.rootNode.clear();
                        this.rootNode.add(this.instanceScene);
                        this.instanceScene.rotation.set(0, THREE.MathUtils.degToRad(180), 0);
                        // this.instanceScene.position.set(0, -0.22, 0.18);

                        this.mainScene.add(this.rootNode);

                        if (json.project) { this.applyProjectSettings(json.project); }
                        this.loadScripts(json.scripts || {});
                        this.play();

                        resolve(this.rootNode);
                    } catch (error) {
                        reject(error);
                    }
                },
                (xhr) => {
                    if (typeof onProgress !== 'function') return;

                    const hasTotal = Number.isFinite(xhr.total) && xhr.total > 0;
                    const progress = hasTotal ? Math.min(xhr.loaded / xhr.total, 1) : 0;

                    onProgress({
                        loaded: xhr.loaded,
                        total: hasTotal ? xhr.total : null,
                        progress,
                    });
                },
                (error) => reject(error)
            );
        });
    }

    applyProjectSettings(project) {
        if (project.toneMapping !== undefined) { this.renderer.toneMapping = project.toneMapping; }
        if (project.toneMappingExposure !== undefined) { this.renderer.toneMappingExposure = project.toneMappingExposure; }
        if (project.shadows !== undefined) { this.renderer.shadowMap.enabled = project.shadows; }
        if (project.shadowType !== undefined) { this.renderer.shadowMap.type = project.shadowType; }
    }

    // scripts: { [uuid del objeto]: [{ name, source }] }, tal como lo guarda el editor.
    loadScripts(scripts) {
        this.scriptEvents = {};
        for (const type of SCRIPT_EVENT_TYPES) { this.scriptEvents[type] = []; }

        for (const uuid in scripts) {
            const object = this.loadedScene.getObjectByProperty('uuid', uuid);

            if (!object) {
                console.warn("ThreePlayer: no se encontró el objeto del script", uuid);
                continue;
            }

            for (const script of scripts[uuid]) {
                const label = `${object.name || object.type} / ${script.name}`;

                try {
                    const functions = new Function(SCRIPT_PARAMS, script.source + "\nreturn " + SCRIPT_RESULT + ";")
                        .bind(object)(this, this.renderer, this.loadedScene, this.camera, this.face, THREE);

                    for (const type in functions) {
                        if (typeof functions[type] !== 'function') continue;
                        this.scriptEvents[type].push({ label, handler: functions[type].bind(object) });
                    }
                } catch (error) {
                    console.error(`ThreePlayer: error en el script "${label}"`, error);
                }
            }
        }

        this.dispatch("init");
    }

    dispatch(type, event) {
        const handlers = this.scriptEvents[type];
        if (!handlers) return;

        for (const { label, handler } of handlers) {
            try {
                handler(event);
            } catch (error) {
                console.error(`ThreePlayer: error en "${label}" (${type})`, error);
            }
        }
    }

    play() {
        this.time = 0;
        this.clock.getDelta();
        for (const type of INPUT_EVENT_TYPES) { document.addEventListener(type, this.onInputEvent); }
        this.dispatch("start");
    }

    stop() {
        for (const type of INPUT_EVENT_TYPES) { document.removeEventListener(type, this.onInputEvent); }
        this.dispatch("stop");
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    update() {
        // Igual que el editor: time y delta en milisegundos.
        const delta = this.clock.getDelta() * 1000;
        this.time += delta;
        this.dispatch("update", { time: this.time, delta });

        this.renderer.render(this.mainScene, this.camera);
    }
}
