import { DrawingUtils, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";

export default class MPFaceRenderer {

    constructor(video, canvas) {
        this.video = video;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.drawer = new DrawingUtils(this.ctx);

        this.showHelpers = false;
        this.showMesh = true;
        this.showContours = true;
        this.showIrises = true;
        this.showPoints = true;
    }

    clear() {
        this.ctx.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );
    }

    
    drawMesh(landmarks) {
        this.resize();
        this.clear();
        if (!landmarks || !this.showMesh || !this.showHelpers)
            return;

        this.drawer.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            {
                color: "#ffffff8c",
                lineWidth: 1
            }
        );
    }

    drawContours(landmarks) {
        if (!landmarks || !this.showContours || !this.showHelpers)
            return;
        this.drawer.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_CONTOURS,
            {
                color: "#00FFFF",
                lineWidth: 2
            }
        );
    }

    drawIrises(landmarks) {
        if (!landmarks || !this.showIrises || !this.showHelpers)
            return;

        this.drawer.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
            {
                color: "#FF0000",
                lineWidth: 2
            }
        );

        this.drawer.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
            {
                color: "#FF0000",
                lineWidth: 2
            }
        );
    }

    drawPoints(landmarks, radius = 2) {
        if (!landmarks || !this.showPoints || !this.showHelpers)
            return;

        this.ctx.fillStyle = "#e5fd09";

        for (const point of landmarks) {

            this.ctx.beginPath();

            this.ctx.arc(
                point.x * this.canvas.width,
                point.y * this.canvas.height,
                radius,
                0,
                Math.PI * 2
            );

            this.ctx.fill();

        }
    }

    resize() {

        if (!this.video.videoWidth || !this.video.videoHeight)
            return;

        if (
            this.canvas.width !== this.video.videoWidth ||
            this.canvas.height !== this.video.videoHeight
        ) {

            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
        }
    }
}