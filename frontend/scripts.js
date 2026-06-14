// --- 1. 最頂層：全域變數宣告 (確保所有 function 都看得到) ---
var player;
//Playing = false;
var isPlayerReady = false; // 這是關鍵訊號
var currentMidiData = null;
var currentChord = [60, 64, 67];
var midiOutput = null;

let guideLayer = null;
let videoElement, canvasCtx, canvasElement;
let latestHandResults = null;
let myHarp = new Harp();
const mySkeleton = new Skeleton({ color: "rgb(255, 255, 255)", lineWidth: 5 });
let smoothLandmarks = {};
let smoothHandLandmarks = {
  left: null,
  right: null,
};

let smoothFrame = {
  center: { x: 0.5, y: 0.5 },
  forward2D: { x: 1, y: 0 },
  stringDir2D: { x: 0, y: 1 },
};
const SMOOTH_FACTOR = 0.15;
const HAND_SMOOTH_FACTOR = 0.175;

// --- 2. 工具函數 (放在最外層，全域可用) ---
function getYouTubeID(url) {
  if (!url) return null;
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
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
  if (event.data == YT.PlayerState.PLAYING) {
    console.log("START VIDEO");
    updateVideoCounter();
  } else {
    console.log("VIDEO PAUSE OR STOP");
    cancelAnimationFrame(timeRequestId);
  }
}

// --- 4. 換歌邏輯 (放在最外層，確保 Selector 叫得到) ---
window.switchSong = async function (selectedSong) {
  if (!selectedSong) return;
  //change scean
  if (selectedSong.scene) {
    document.body.className = selectedSong.scene; // 切換 class 即可瞬間換圖
  }
  //change song
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
    currentMidiData = await loadAndAnalyzeMidi(
      selectedSong.url,
      selectedSong.firstBeatOffset || 0,
    );
    const bpmDisplay = document.getElementById("song-bpm-display");
    if (bpmDisplay)
      bpmDisplay.innerText = `BPM: ${currentMidiData.bpm} | 音符: ${currentMidiData.totalNotes}`;
    tryCueVideo();
  } catch (err) {
    console.error("切換失敗", err);
  }
};
//對齊影片
let timeRequestId;
let lastChordString = "";

function updateVideoCounter() {
  const timeDisplay = document.getElementById("video-current-time");

  if (timeDisplay && player && player.getCurrentTime) {
    const currentTime = player.getCurrentTime();
    timeDisplay.innerText = currentTime.toFixed(3);

    if (currentMidiData && currentMidiData.progression) {
      const activeNotes = getActiveChord(currentTime, currentMidiData);
      const currentStr = JSON.stringify(activeNotes);

      //console test
      if (currentStr !== lastChordString) {
        console.log(
          `當前和弦：${chordAnalyze(activeNotes).name}|當前和弦內音符：[${activeNotes.join(",")}]`,
        );
        lastChordString = currentStr;
      }
    }
    //baseOffset對齊運算
    //check MIDI event
  }
  timeRequestId = requestAnimationFrame(updateVideoCounter);
}
// --- 5. MediaPipe 與 相機 (必須在 window.onload，因為要抓 HTML 元素) ---
window.onload = () => {
  videoElement = document.querySelector(".input_video");
  canvasElement = document.querySelector(".output_canvas");
  guideLayer = document.getElementById("detection-guide");
  canvasCtx = canvasElement.getContext("2d");

  canvasElement.width = 1280;
  canvasElement.height = 640;

  document.body.className = ""; //初始化襪defualt紙
  //Pose骨架
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

  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  //hand骨架
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  hands.onResults((results) => {
    latestHandResults = results;
  });

  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
      await pose.send({ image: videoElement });
    },
    width: 1280,
    height: 640,
  });
  camera.start();
  setupHarpControls(); //綁定搖桿的控制參數

  // 監聽選單
  const selector = document.getElementById("songSelector");
  if (selector) {
    selector.addEventListener("change", (e) => {
      const song = IMUSE_SONGS[e.target.value];
      window.switchSong(song);
    });
  }
};

//判斷抓到鼻子、肩膀
function checkDetection(results, guide, canvas) {
  const lm = results.poseLandmarks;

  // 1. 核心判斷：頭(0)與雙肩(11, 12) 是否都在畫面內且信心度 > 0.5
  const isDetected = !!(
    lm &&
    lm[0]?.visibility > 0.5 &&
    lm[11]?.visibility > 0.5 &&
    lm[12]?.visibility > 0.5
  );

  // 2. 切換 UI 狀態 (使用 Bootstrap 的 d-none)
  if (guide) guide.classList.toggle("d-none", isDetected);
  if (canvas) canvas.style.opacity = isDetected ? "1" : "0.3";

  return isDetected;
}
// --- 6. 核心計算 (保留你原本的所有主程式邏輯) ---
async function onResults(results) {
  const isReady = checkDetection(results, guideLayer, canvasElement);

  if (!isReady) {
    const ctx = canvasElement.getContext("2d");
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    // 在畫布內也畫一個半透明的人影，比起單純 CSS 更有質感
    ctx.save();
    ctx.globalAlpha = 0.5; // 畫布層級的半透明
    ctx.drawImage(
      results.image,
      0,
      0,
      canvasElement.width,
      canvasElement.height,
    );
    ctx.restore();
    return;
  }
  //POSE骨架平滑
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
      smoothLandmarks[i].visibility = raw.visibility;
    }
  });
  const displayLandmarks = results.poseLandmarks.map(
    (point, index) => smoothLandmarks[index] || point,
  );

  // 新增：Hands EMA 平滑後的結果
  const displayHandLandmarks = smoothHands(
    latestHandResults?.multiHandLandmarks || [],
    displayLandmarks,
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
    //選定手指當作傳入豎琴判斷的節點
    const ACTIVATE_THRESHOLD = 0.98;
    const fingerPoints = [];

    const hands = displayHandLandmarks;
    const leftWrist = displayLandmarks[15];
    const rightWrist = displayLandmarks[16];

    hands.forEach((hand) => {
      if (!hand?.[0] || !hand?.[12]) return;

      const wrist = hand[0];
      const tip = hand[12]; // 中指尖

      const dLeft = (wrist.x - leftWrist.x) ** 2 + (wrist.y - leftWrist.y) ** 2;
      const dRight =
        (wrist.x - rightWrist.x) ** 2 + (wrist.y - rightWrist.y) ** 2;

      const isLeftHand = dLeft < dRight;
      const poseWrist = isLeftHand ? leftWrist : rightWrist;

      fingerPoints.push({
        id: isLeftHand ? "leftMiddle" : "rightMiddle",
        x: (tip.x + poseWrist.x - wrist.x) * canvasElement.width,
        y: (tip.y + poseWrist.y - wrist.y) * canvasElement.height,
      });
    });

    if (player && typeof player.getCurrentTime === "function") {
      currentChord = getActiveChord(player.getCurrentTime(), currentMidiData);
    } else {
      currentChord = [60, 64, 67];
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (myHarp) myHarp.update(smoothFrame, fingerPoints, currentChord);

    mySkeleton.draw(
      canvasCtx,
      displayLandmarks,
      canvasElement.width,
      canvasElement.height,
      fx,
      displayHandLandmarks,
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
// 新增：用 hand[0] 手腕離 Pose 左右手腕的距離，判斷這隻 hand 是左手還右手
function getHandSide(hand, poseLandmarks) {
  if (!hand?.[0] || !poseLandmarks?.[15] || !poseLandmarks?.[16]) return null;

  const wrist = hand[0];
  const leftWrist = poseLandmarks[15];
  const rightWrist = poseLandmarks[16];

  const dLeft = (wrist.x - leftWrist.x) ** 2 + (wrist.y - leftWrist.y) ** 2;
  const dRight = (wrist.x - rightWrist.x) ** 2 + (wrist.y - rightWrist.y) ** 2;

  return dLeft < dRight ? "left" : "right";
}

// 新增：Hands EMA 平滑
function smoothHands(rawHands, poseLandmarks) {
  if (!rawHands || rawHands.length === 0) return [];

  const displayHands = [];

  rawHands.forEach((hand) => {
    if (!hand?.[0]) return;

    const side = getHandSide(hand, poseLandmarks);
    if (!side) return;

    if (!smoothHandLandmarks[side]) {
      smoothHandLandmarks[side] = hand.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z ?? 0,
      }));
    } else {
      hand.forEach((p, i) => {
        if (!p) return;

        smoothHandLandmarks[side][i].x = lerp(
          smoothHandLandmarks[side][i].x,
          p.x,
          HAND_SMOOTH_FACTOR,
        );

        smoothHandLandmarks[side][i].y = lerp(
          smoothHandLandmarks[side][i].y,
          p.y,
          HAND_SMOOTH_FACTOR,
        );

        smoothHandLandmarks[side][i].z = lerp(
          smoothHandLandmarks[side][i].z,
          p.z ?? 0,
          HAND_SMOOTH_FACTOR,
        );
      });
    }

    displayHands.push(smoothHandLandmarks[side]);
  });

  return displayHands;
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

function setupHarpControls() {
  const stringCountSlider = document.getElementById("stringCountSlider");
  const spacingSlider = document.getElementById("spacingSlider");
  const baseOffsetSlider = document.getElementById("baseOffsetSlider");
  const yOffsetSlider = document.getElementById("yOffsetSlider");

  const stringCountValue = document.getElementById("stringCountValue");
  const spacingValue = document.getElementById("spacingValue");
  const baseOffsetValue = document.getElementById("baseOffsetValue");
  const yOffsetValue = document.getElementById("yOffsetValue");

  if (!myHarp) return;

  stringCountSlider.addEventListener("input", () => {
    const value = Number(stringCountSlider.value);
    myHarp.setStringCount(value);
    stringCountValue.textContent = value;
  });

  spacingSlider.addEventListener("input", () => {
    const value = Number(spacingSlider.value);
    myHarp.spacing = value;
    spacingValue.textContent = value.toFixed(3);
  });

  baseOffsetSlider.addEventListener("input", () => {
    const value = Number(baseOffsetSlider.value);
    myHarp.baseOffset = value;
    baseOffsetValue.textContent = value.toFixed(3);
  });

  yOffsetSlider.addEventListener("input", () => {
    const value = Number(yOffsetSlider.value);
    myHarp.yOffset = value;
    yOffsetValue.textContent = value.toFixed(3);
  });
}
