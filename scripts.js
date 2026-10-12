// --- 1. 最頂層：全域變數宣告 ---
var player;
var isPlayerReady = false;
var currentMidiData = null;
var currentChord = [60, 64, 67];

let guideLayer = null;
let videoElement, canvasCtx, canvasElement;
let latestHandResults = null;
let myHarp = new Harp();
const mySkeleton = new Skeleton({ color: "rgb(255, 255, 255)", lineWidth: 5 });
let smoothLandmarks = {};
let smoothHandLandmarks = { left: null, right: null };

// 觸發模式與雙手 Plucking 狀態機
let currentPlayMode = "glissando";
const handPluckState = { left: "EXTENDED", right: "EXTENDED" };

let smoothFrame = {
  center: { x: 0.5, y: 0.5 },
  forward2D: { x: 1, y: 0 },
  stringDir2D: { x: 0, y: 1 },
};
const SMOOTH_FACTOR = 0.15;
const HAND_SMOOTH_FACTOR = 0.175;

// --- 2. 工具函數 ---
function getYouTubeID(url) {
  if (!url) return null;
  const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

function calculateAngle(p1, p2, p3) {
  const v1x = p1.x - p2.x, v1y = p1.y - p2.y;
  const v2x = p3.x - p2.x, v2y = p3.y - p2.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  return mag === 0 ? 180 : (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function lerp(start, end, amt) {
  return start + (end - start) * amt;
}

function getHandSide(hand, poseLandmarks) {
  if (!hand?.[0] || !poseLandmarks?.[15] || !poseLandmarks?.[16]) return null;
  return (hand[0].x - poseLandmarks[15].x) ** 2 + (hand[0].y - poseLandmarks[15].y) ** 2 <
         (hand[0].x - poseLandmarks[16].x) ** 2 + (hand[0].y - poseLandmarks[16].y) ** 2
    ? "left"
    : "right";
}

function smoothHands(rawHands, poseLandmarks) {
  if (!rawHands || rawHands.length === 0) return [];
  const displayHands = [];

  rawHands.forEach((hand) => {
    if (!hand?.[0]) return;
    const side = getHandSide(hand, poseLandmarks);
    if (!side) return;

    if (!smoothHandLandmarks[side]) {
      smoothHandLandmarks[side] = hand.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    } else {
      hand.forEach((p, i) => {
        if (!p) return;
        smoothHandLandmarks[side][i].x = lerp(smoothHandLandmarks[side][i].x, p.x, HAND_SMOOTH_FACTOR);
        smoothHandLandmarks[side][i].y = lerp(smoothHandLandmarks[side][i].y, p.y, HAND_SMOOTH_FACTOR);
        smoothHandLandmarks[side][i].z = lerp(smoothHandLandmarks[side][i].z, p.z ?? 0, HAND_SMOOTH_FACTOR);
      });
    }
    displayHands.push(smoothHandLandmarks[side]);
  });
  return displayHands;
}

function computeFrameFromPose(landmarks) {
  const p11 = landmarks[11], p12 = landmarks[12], p23 = landmarks[23], p24 = landmarks[24];
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
  const forward2D = magF < 1e-6 ? { x: 1, y: 0 } : { x: cross.x / magF, y: cross.y / magF };
  const vS = {
    x: (p23.x + p24.x) / 2 - (p11.x + p12.x) / 2,
    y: (p23.y + p24.y) / 2 - (p11.y + p12.y) / 2,
  };
  const magS = Math.hypot(vS.x, vS.y);
  const stringDir2D = magS < 1e-6 ? { x: 0, y: 1 } : { x: vS.x / magS, y: vS.y / magS };
  return { center, forward2D, stringDir2D };
}

// --- 3. YouTube API 核心 ---
function onYouTubeIframeAPIReady() {
  const selector = document.getElementById("songSelector");
  const selectedIndex = selector ? selector.selectedIndex : 0;

  if (typeof IMUSE_SONGS !== "undefined" && IMUSE_SONGS[selectedIndex]) {
    player = new YT.Player("player", {
      height: "240",
      width: "400",
      videoId: getYouTubeID(IMUSE_SONGS[selectedIndex].youtubeUrl),
      playerVars: { playsinline: 1, enablejsapi: 1, origin: window.location.origin },
      events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange },
    });
  }
}

function onPlayerReady() {
  isPlayerReady = true;
  console.log("✅ 播放器已就緒！");
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    updateVideoCounter();
  } else {
    cancelAnimationFrame(timeRequestId);
  }
}

// --- 4. 換歌與計時邏輯 ---
window.switchSong = async function (selectedSong) {
  if (!selectedSong) return;
  if (selectedSong.scene) document.body.className = selectedSong.scene;

  const vId = getYouTubeID(selectedSong.youtubeUrl);
  const tryCueVideo = () => {
    if (isPlayerReady && player?.cueVideoById) {
      player.cueVideoById(vId);
    } else {
      setTimeout(tryCueVideo, 500);
    }
  };

  const infoContainer = document.querySelector(".song-info");
  if (infoContainer) {
    infoContainer.innerHTML = `
      <h2 style="margin:0; font-size: 36px; color: #ffffff">${selectedSong.title}</h2>
      <p id="song-bpm-display" style="margin:5px 0 0 0; color: #ededed;">BPM: 解析中...</p>
      <div id="timer-container" style="font-family: monospace; font-size: 1.2rem; color: #ffffff; margin-top: 10px;">
        Time: <span id="video-current-time">0.00</span> s
      </div>
    `;
  }

  try {
    currentMidiData = await loadAndAnalyzeMidi(selectedSong.url, selectedSong.firstBeatOffset || 0);
    const bpmDisplay = document.getElementById("song-bpm-display");
    if (bpmDisplay) bpmDisplay.innerText = `BPM: ${currentMidiData.bpm} | 音符: ${currentMidiData.totalNotes}`;
    tryCueVideo();
  } catch (err) {
    console.error("切換失敗", err);
  }
};

let timeRequestId;
let lastChordString = "";

function updateVideoCounter() {
  const timeDisplay = document.getElementById("video-current-time");
  if (timeDisplay && player?.getCurrentTime) {
    const currentTime = player.getCurrentTime();
    timeDisplay.innerText = currentTime.toFixed(3);

    if (currentMidiData?.progression) {
      const currentStr = JSON.stringify(getActiveChord(currentTime, currentMidiData));
      if (currentStr !== lastChordString) {
        lastChordString = currentStr;
      }
    }
  }
  timeRequestId = requestAnimationFrame(updateVideoCounter);
}

// --- 5. MediaPipe 與相機啟動 ---
window.onload = () => {
  // 1. 綁定首次輕觸/點擊畫面：啟動音訊並清空提示文字
  const handleFirstInteraction = async () => {
    await initAudio();

    const hint = document.getElementById("audio-init-hint");
    if (hint) {
      hint.textContent = " ";
    }

    // 移除一次性監聽
    window.removeEventListener("pointerdown", handleFirstInteraction);
    window.removeEventListener("keydown", handleFirstInteraction);
  };

  window.addEventListener("pointerdown", handleFirstInteraction, { once: true });
  window.addEventListener("keydown", handleFirstInteraction, { once: true });

  // 2. 預設和弦直接開始運作
  loadPresetProgression("standard");
  startAutoChord(60, 3);

  // 3. 後續的相機、MediaPipe 與 UI 控制綁定保持不變...
  videoElement = document.querySelector(".input_video");
  canvasElement = document.querySelector(".output_canvas");
  guideLayer = document.getElementById("detection-guide");
  canvasCtx = canvasElement.getContext("2d");
  canvasElement.width = 1280;
  canvasElement.height = 640;
  document.body.className = "";

  const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
  pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  pose.onResults(onResults);

  const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  hands.onResults((results) => { latestHandResults = results; });

  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
      await pose.send({ image: videoElement });
    },
    width: 1280,
    height: 640,
  });
  camera.start();

  setupHarpControls();

  const selector = document.getElementById("songSelector");
  if (selector) {
    selector.addEventListener("change", (e) => window.switchSong(IMUSE_SONGS[e.target.value]));
  }
};

function checkDetection(results, guide, canvas) {
  const lm = results.poseLandmarks;
  const isDetected = !!(lm && lm[0]?.visibility > 0.5 && lm[11]?.visibility > 0.5 && lm[12]?.visibility > 0.5);
  if (guide) guide.classList.toggle("d-none", isDetected);
  if (canvas) canvas.style.opacity = isDetected ? "1" : "0.3";
  return isDetected;
}

// --- 6. 核心計算 ---
async function onResults(results) {
  if (!checkDetection(results, guideLayer, canvasElement)) {
    const ctx = canvasElement.getContext("2d");
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    ctx.restore();
    return;
  }

  if (!canvasCtx || !results.poseLandmarks) return;

  const targetIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 23, 24];
  targetIndices.forEach((i) => {
    const raw = results.poseLandmarks[i];
    if (!raw) return;
    if (!smoothLandmarks[i]) {
      smoothLandmarks[i] = { x: raw.x, y: raw.y, z: raw.z, visibility: raw.visibility };
    } else {
      smoothLandmarks[i].x = lerp(smoothLandmarks[i].x, raw.x, SMOOTH_FACTOR);
      smoothLandmarks[i].y = lerp(smoothLandmarks[i].y, raw.y, SMOOTH_FACTOR);
      smoothLandmarks[i].z = lerp(smoothLandmarks[i].z, raw.z, SMOOTH_FACTOR);
      smoothLandmarks[i].visibility = raw.visibility;
    }
  });

  const displayLandmarks = results.poseLandmarks.map((point, index) => smoothLandmarks[index] || point);
  const displayHandLandmarks = smoothHands(latestHandResults?.multiHandLandmarks || [], displayLandmarks);
  const rawFrame = computeFrameFromPose(displayLandmarks);

  if (rawFrame) {
    smoothFrame.center.x = lerp(smoothFrame.center.x, rawFrame.center.x, SMOOTH_FACTOR);
    smoothFrame.center.y = lerp(smoothFrame.center.y, rawFrame.center.y, SMOOTH_FACTOR);
    smoothFrame.forward2D.x = lerp(smoothFrame.forward2D.x, rawFrame.forward2D.x, SMOOTH_FACTOR);
    smoothFrame.forward2D.y = lerp(smoothFrame.forward2D.y, rawFrame.forward2D.y, SMOOTH_FACTOR);
    smoothFrame.stringDir2D.x = lerp(smoothFrame.stringDir2D.x, rawFrame.stringDir2D.x, SMOOTH_FACTOR);
    smoothFrame.stringDir2D.y = lerp(smoothFrame.stringDir2D.y, rawFrame.stringDir2D.y, SMOOTH_FACTOR);

    const fingerPoints = [];

    if (currentPlayMode === "glissando") {
      // 掃弦模式：抓中指尖 (12)
      displayHandLandmarks.forEach((hand) => {
        if (!hand?.[0] || !hand?.[12]) return;
        const isLeft = getHandSide(hand, displayLandmarks) === "left";
        const pw = displayLandmarks[isLeft ? 15 : 16];

        fingerPoints.push({
          id: isLeft ? "leftMiddle" : "rightMiddle",
          x: (hand[12].x + pw.x - hand[0].x) * canvasElement.width,
          y: (hand[12].y + pw.y - hand[0].y) * canvasElement.height,
        });
      });
    } else if (currentPlayMode === "plucking") {
      // 撥弦模式：微摳手勢 + 掌心中心雙音
      displayHandLandmarks.forEach((hand) => {
        if (!hand?.[0] || !hand?.[5] || !hand?.[9] || !hand?.[10] || !hand?.[11] || !hand?.[13] || !hand?.[17]) return;
        const side = getHandSide(hand, displayLandmarks);

        if (calculateAngle(hand[9], hand[10], hand[11]) > 148) {
          handPluckState[side] = "EXTENDED";
        } else if (calculateAngle(hand[9], hand[10], hand[11]) < 140 && handPluckState[side] === "EXTENDED") {
          if (Date.now() - myHarp.lastTriggerTime > myHarp.stringTriggerCooldown) {
            handPluckState[side] = "TRIGGERED";
            const pw = displayLandmarks[side === "left" ? 15 : 16];

            const base = myHarp.getClosestStringIndex({
              x: ((hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 4 + pw.x - hand[0].x) * canvasElement.width,
              y: ((hand[5].y + hand[9].y + hand[13].y + hand[17].y) / 4 + pw.y - hand[0].y) * canvasElement.height,
            }, smoothFrame);

            if (base !== -1) {
              myHarp._triggerStrings([base, side === "left" ? base + 1 : base - 1], currentChord);
              myHarp.lastTriggerTime = Date.now();
            }
          }
        }
      });
    }

    currentChord = player?.getCurrentTime
      ? getActiveChord(player.getCurrentTime(), currentMidiData)
      : [60, 64, 67];

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (myHarp) myHarp.update(smoothFrame, fingerPoints, currentChord);
    mySkeleton.draw(canvasCtx, displayLandmarks, canvasElement.width, canvasElement.height, smoothFrame.forward2D.x, displayHandLandmarks);
    myHarp.draw(canvasCtx, smoothFrame, canvasElement.width, canvasElement.height);

    canvasCtx.restore();
  }
}

// --- 7. UI 控制面板綁定 ---
function setupHarpControls() {
  if (!myHarp) return;

  const bindSlider = (id, callback, digits = 0) => {
    const slider = document.getElementById(id);
    const label = document.getElementById(id.replace("Slider", "Value"));
    slider?.addEventListener("input", () => {
      const val = Number(slider.value);
      if (label) label.textContent = digits ? val.toFixed(digits) : val;
      callback(val);
    });
  };

  bindSlider("stringCountSlider", (val) => {
    myHarp.setStringCount(val);
    if (chordManager?.currentNotes) {
      currentChord = chordManager.currentHarpNotes = mappingToString(chordManager.currentNotes, val);
    }
  });
  bindSlider("spacingSlider", (val) => myHarp.spacing = val, 3);
  bindSlider("baseOffsetSlider", (val) => myHarp.baseOffset = val, 3);
  bindSlider("yOffsetSlider", (val) => myHarp.yOffset = val, 3);

  document.querySelectorAll('input[name="playMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) currentPlayMode = e.target.value;
    });
  });
}