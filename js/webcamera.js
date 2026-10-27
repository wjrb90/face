export default class WebCamera {

    constructor(video) {    
        this.video = video;
        this.stream = null;
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.muted = true;    
    }

    async startCamera(deviceId = null) {

        if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); }

        const videoConstraints = {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 }
        };

        if (deviceId) {
            videoConstraints.deviceId = { exact: deviceId };
        } else {
            videoConstraints.facingMode = "user";
        }

        this.stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints
        });

        this.video.srcObject = this.stream;
        await this.video.play();        
    }

    stopCamera() {
        if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); }
        this.stream = null;
        this.video.srcObject = null;
    }

    async getCameras() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === "videoinput");
    }

    async changeCamera(deviceId) { await this.startCamera(deviceId); }
}