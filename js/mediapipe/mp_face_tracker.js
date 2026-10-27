import {
    FaceLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";

export default class MPFaceTracker {

    constructor(video) {

        this.video = video;

        this.landmarker = null;
        this.results = null;

        this.lastVideoTime = -1;

    }

    async init() {

        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm"
        );

        this.landmarker = await FaceLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath: "./assets/mediapipe/face_landmarker.task",
                    delegate: "GPU"
                },

                runningMode: "VIDEO",

                numFaces: 1,

                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,

                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true
            }
        );

    }

    update() {

        if (!this.landmarker)
            return false;

        if (this.video.currentTime === this.lastVideoTime)
            return false;

        this.lastVideoTime = this.video.currentTime;

        this.results = this.landmarker.detectForVideo(
            this.video,
            performance.now()
        );

        return true;

    }

    isDetectingFace() { return this.getFaceCount() > 0; }

    getFaceCount() {

        if (!this.results?.faceLandmarks)
            return 0;

        return this.results.faceLandmarks.length;

    }

    getLandmarks(index = 0) {

        if (!this.results?.faceLandmarks)
            return null;

        return this.results.faceLandmarks[index] ?? null;

    }

    getHeadMatrix(index = 0) {

        if (!this.results?.facialTransformationMatrixes)
            return null;

        return this.results.facialTransformationMatrixes[index]?.data ?? null;

    }

    getBlendShapes(index = 0) {

        if (!this.results?.faceBlendshapes)
            return [];

        return this.results.faceBlendshapes[index]?.categories ?? [];

    }

    getBlendShape(name, index = 0) {

        const blendShape = this
            .getBlendShapes(index)
            .find(x => x.categoryName === name);

        return blendShape ? blendShape.score : 0;

    }

    isMouthOpen(threshold = 0.4) { return this.getBlendShape("jawOpen") > threshold; }
    getMouthOpen() { return this.getBlendShape("jawOpen"); }


    getLandmark(id, faceIndex = 0) {
        const landmarks = this.getLandmarks(faceIndex);
        if (!landmarks)
            return null;
        return landmarks[id] ?? null;
    }

    getNoseTip(faceIndex = 0) { return this.getLandmark(1, faceIndex); }
    getLeftEye(faceIndex = 0) { return this.getLandmark(33, faceIndex); }
    getRightEye(faceIndex = 0) { return this.getLandmark(263, faceIndex); }
    getChin(faceIndex = 0) { return this.getLandmark(152, faceIndex); }

}