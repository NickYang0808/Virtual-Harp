// --- 1. 最頂層：全域變數宣告 (確保所有 function 都看得到) ---
var player;
var isVideoPlaying = false;
var isPlayerReady = false; // 這是關鍵訊號
var currentMidiData = null;
var currentChord = [60, 64, 67];
var midiOutput = null;

let videoElement, canvasElement, canvasCtx;
let myHarp = new Harp();
const mySkeleton = new Skeleton({ color: "#003cffff", lineWidth: 4 });
let smoothLandmarks = {};
let smoothFrame = {
  center: { x: 0.5, y: 0.5 },
  forward2D: { x: 1, y: 0 },
  stringDir2D: { x: 0, y: 1 },
};
const SMOOTH_FACTOR = 0.15;

// --- 2. 工具函數 (放在最外層，全域可用) ---
function getYouTubeID(url) {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

function getActiveChord(videoTime, midiData) {
  if (!isVideoPlaying || !midiData || !midiData.hasLeftHand)
    return [60, 64, 67];
  const activeProg = [...midiData.progression]
    .reverse()
    .find((p) => videoTime >= p.videoTime);
  return activeProg ? activeProg.notes : [60, 64, 67];
}

// --- 3. YouTube API 核心 (必須在最外層，絕對不能放進 window.onload) ---
// 這樣 YouTube API 載入時才叫得到它
function onYouTubeIframeAPIReady() {
  console.log("🎬 YouTube API 呼叫：開始初始化 Player...");
  const selector = document.getElementById("songSelector");
  const selectedIndex = selector ? selector.selectedIndex : 0;

  if (typeof IMUSE_SONGS !== "undefined" && IMUSE_SONGS[selectedIndex]) {
    const vId = getYouTubeID(IMUSE_SONGS[selectedIndex].youtubeUrl);
    player = new YT.Player("player", {
      height: "240",
      width: "400",
      videoId: vId,
      playerVars: {
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      },
      events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange },
    });
  }
}

function onPlayerReady(event) {
  isPlayerReady = true; // 這裡一變 true，switchSong 就不會再死循環了
  console.log("✅ 播放器已就緒！");
}

function onPlayerStateChange(event) {
  isVideoPlaying = event.data === YT.PlayerState.PLAYING;
}

// --- 4. 換歌邏輯 (放在最外層，確保 Selector 叫得到) ---
window.switchSong = async function (selectedSong) {
  if (!selectedSong) return;
  console.log("🎵 切換歌曲：", selectedSong.title);
  const vId = getYouTubeID(selectedSong.youtubeUrl);

  const tryCueVideo = () => {
    // 嚴格判斷：必須 player 存在且 Ready 訊號為 true
    if (isPlayerReady && player && typeof player.cueVideoById === "function") {
      player.cueVideoById(vId);
      console.log("🎬 影片更換成功:", vId);
    } else {
      console.log(
        "⏳ 正在等待播放器就緒... (請確認 HTML 中有 <div id='player'>)",
      );
      setTimeout(tryCueVideo, 500);
    }
  };

  try {
    currentMidiData = await loadAndAnalyzeMidi(
      selectedSong.url,
      selectedSong.firstBeatOffset || 0,
    );
    tryCueVideo();
  } catch (err) {
    console.error("MIDI 載入出錯", err);
  }
};

// --- 5. MediaPipe 與 相機 (必須在 window.onload，因為要抓 HTML 元素) ---
window.onload = () => {
  videoElement = document.querySelector(".input_video");
  canvasElement = document.querySelector(".output_canvas");
  canvasCtx = canvasElement.getContext("2d");
  canvasElement.width = 1280;
  canvasElement.height = 640;

  WebMidi.enable().then(() => {
    midiOutput = WebMidi.outputs[0];
  });

  const pose = new Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pose.onResults(onResults);

  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await pose.send({ image: videoElement });
    },
    width: 1280,
    height: 640,
  });
  camera.start();

  // 監聽選單
  const selector = document.getElementById("songSelector");
  if (selector) {
    selector.addEventListener("change", (e) => {
      const song = IMUSE_SONGS[e.target.value];
      window.switchSong(song);
    });
  }
};

// --- 6. 核心計算 (保留你原本的所有主程式邏輯) ---
async function onResults(results) {
  if (!canvasCtx || !results.poseLandmarks) return;
  const targetIndices = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 23, 24,
  ];
  targetIndices.forEach((i) => {
    const raw = results.poseLandmarks[i];
    if (!raw) return;
    if (!smoothLandmarks[i]) {
      smoothLandmarks[i] = {
        x: raw.x,
        y: raw.y,
        z: raw.z,
        visibility: raw.visibility,
      };
    } else {
      smoothLandmarks[i].x = lerp(smoothLandmarks[i].x, raw.x, SMOOTH_FACTOR);
      smoothLandmarks[i].y = lerp(smoothLandmarks[i].y, raw.y, SMOOTH_FACTOR);
      smoothLandmarks[i].z = lerp(smoothLandmarks[i].z, raw.z, SMOOTH_FACTOR);
    }
  });
  const displayLandmarks = results.poseLandmarks.map(
    (point, index) => smoothLandmarks[index] || point,
  );
  const rawFrame = computeFrameFromPose(displayLandmarks);
  if (rawFrame) {
    smoothFrame.center.x = lerp(
      smoothFrame.center.x,
      rawFrame.center.x,
      SMOOTH_FACTOR,
    );
    smoothFrame.center.y = lerp(
      smoothFrame.center.y,
      rawFrame.center.y,
      SMOOTH_FACTOR,
    );
    smoothFrame.forward2D.x = lerp(
      smoothFrame.forward2D.x,
      rawFrame.forward2D.x,
      SMOOTH_FACTOR,
    );
    smoothFrame.forward2D.y = lerp(
      smoothFrame.forward2D.y,
      rawFrame.forward2D.y,
      SMOOTH_FACTOR,
    );
    smoothFrame.stringDir2D.x = lerp(
      smoothFrame.stringDir2D.x,
      rawFrame.stringDir2D.x,
      SMOOTH_FACTOR,
    );
    smoothFrame.stringDir2D.y = lerp(
      smoothFrame.stringDir2D.y,
      rawFrame.stringDir2D.y,
      SMOOTH_FACTOR,
    );

    const fx = smoothFrame.forward2D.x;
    const fingerPoints = [19, 20]
      .map((i) => ({
        ...displayLandmarks[i],
        id: i,
        x: displayLandmarks[i].x * canvasElement.width,
        y: displayLandmarks[i].y * canvasElement.height,
      }))
      .filter((p) =>
        fx < -0.98 ? p.id === 19 : fx > 0.98 ? p.id === 20 : false,
      );

    if (
      player &&
      typeof player.getCurrentTime === "function" &&
      isVideoPlaying
    ) {
      currentChord = getActiveChord(player.getCurrentTime(), currentMidiData);
    } else {
      currentChord = [60, 64, 67];
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (myHarp)
      myHarp.update(smoothFrame, fingerPoints, currentChord, midiOutput);
    mySkeleton.draw(
      canvasCtx,
      displayLandmarks,
      canvasElement.width,
      canvasElement.height,
      fx,
    );
    myHarp.draw(
      canvasCtx,
      smoothFrame,
      canvasElement.width,
      canvasElement.height,
    );
    canvasCtx.restore();
  }
}
function lerp(start, end, amt) {
  return start + (end - start) * amt;
}
function computeFrameFromPose(landmarks) {
  const p11 = landmarks[11],
    p12 = landmarks[12],
    p23 = landmarks[23],
    p24 = landmarks[24];
  if (!p11 || !p12 || !p23 || !p24) return null;
  const center = {
    x: (p23.x + p24.x) / 2,
    y: (p23.y + p24.y) / 2 - 0.25,
    z: (p23.z + p24.z) / 4,
  };
  const vA = { x: p11.x - p12.x, y: p11.y - p12.y, z: p11.z - p12.z };
  const vB = { x: p24.x - p12.x, y: p24.y - p12.y, z: p24.z - p12.z };
  const cross = {
    x: vB.y * vA.z - vB.z * vA.y,
    y: vB.z * vA.x - vB.x * vA.z,
    z: vB.x * vA.y - vB.y * vA.x,
  };
  const magF = Math.hypot(cross.x, cross.y);
  const forward2D =
    magF < 1e-6 ? { x: 1, y: 0 } : { x: cross.x / magF, y: cross.y / magF };
  const vS = {
    x: (p23.x + p24.x) / 2 - (p11.x + p12.x) / 2,
    y: (p23.y + p24.y) / 2 - (p11.y + p12.y) / 2,
  };
  const magS = Math.hypot(vS.x, vS.y);
  const stringDir2D =
    magS < 1e-6 ? { x: 0, y: 1 } : { x: vS.x / magS, y: vS.y / magS };
  return { center, forward2D, stringDir2D };
}
