// --- 1. 最頂層：全域變數宣告 (只宣告這一次) ---
var player; 
var isVideoPlaying = false; 
var isPlayerReady =false;
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
    stringDir2D: { x: 0, y: 1 }
};
const SMOOTH_FACTOR = 0.15; 

// --- 2. 工具函數 ---
function getYoutubeId(url) {
    if (!url) return null;
    // 這個正規表示法支援 watch?v=, youtu.be/, embed/ 等所有格式
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// 統一使用這個名稱
function getActiveChord(videoCurrentTime, midiData) {
    if (!isVideoPlaying || !midiData || !midiData.hasLeftHand) {
        return [60, 64, 67];
    }
    // 尋找當前影片時間對應的和弦 (確保 midiHandler 傳出的是 videoTime)
    const activeProg = [...midiData.progression]
        .reverse()
        .find(p => videoCurrentTime >= p.videoTime);
        
    return activeProg ? activeProg.notes : [60, 64, 67];
}

// --- 3. YouTube API (必須在最外層) ---
// 1. 強制讓它變成全域 Window 屬性
window.onYouTubeIframeAPIReady = function() {
    console.log("🎬 YouTube API 腳本已載入，開始初始化 Player...");
    
    player = new YT.Player('player', {
        height: '240',
        width: '400',
        videoId: '9bZkp7q19f0', // 先放一個確定能播的 ID (測試用)
        playerVars: { 
            'playsinline': 1,
            'enablejsapi': 1,
            'origin': window.location.origin 
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    isPlayerReady = true;
    console.log("✅ ✅ ✅ 播放器真的就緒了！");
}

function onPlayerStateChange(event) {
    isVideoPlaying = (event.data === YT.PlayerState.PLAYING);
}
// --- 4. 核心邏輯 onResults ---
async function onResults(results) {
  if (!canvasCtx || !results.poseLandmarks) return;

  // 骨架平滑
  const targetIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 23, 24];
  targetIndices.forEach(i => {
    const raw = results.poseLandmarks[i];
    if (!raw) return;
    if (!smoothLandmarks[i]) {
      smoothLandmarks[i] = { x: raw.x, y: raw.y, z: raw.z, visibility: raw.visibility };
    } else {
      smoothLandmarks[i].x = lerp(smoothLandmarks[i].x, raw.x, SMOOTH_FACTOR);
      smoothLandmarks[i].y = lerp(smoothLandmarks[i].y, raw.y, SMOOTH_FACTOR);
      smoothLandmarks[i].z = lerp(smoothLandmarks[i].z, raw.z, SMOOTH_FACTOR);
    }
  });

  const displayLandmarks = results.poseLandmarks.map((point, index) => {
    return smoothLandmarks[index] ? smoothLandmarks[index] : point;
  });

  const rawFrame = computeFrameFromPose(displayLandmarks);

  if (rawFrame) {
    smoothFrame.center.x = lerp(smoothFrame.center.x, rawFrame.center.x, SMOOTH_FACTOR);
    smoothFrame.center.y = lerp(smoothFrame.center.y, rawFrame.center.y, SMOOTH_FACTOR);
    smoothFrame.forward2D.x = lerp(smoothFrame.forward2D.x, rawFrame.forward2D.x, SMOOTH_FACTOR);
    smoothFrame.forward2D.y = lerp(smoothFrame.forward2D.y, rawFrame.forward2D.y, SMOOTH_FACTOR);
    smoothFrame.stringDir2D.x = lerp(smoothFrame.stringDir2D.x, rawFrame.stringDir2D.x, SMOOTH_FACTOR);
    smoothFrame.stringDir2D.y = lerp(smoothFrame.stringDir2D.y, rawFrame.stringDir2D.y, SMOOTH_FACTOR);

    const fx = smoothFrame.forward2D.x;
    const ACTIVATE_THRESHOLD = 0.98;

    const fingerPoints = [19, 20].map(i => ({
      ...displayLandmarks[i],
      id: i,
      x: displayLandmarks[i].x * canvasElement.width,
      y: displayLandmarks[i].y * canvasElement.height
    })).filter(p => {
      if (fx < -ACTIVATE_THRESHOLD) return p.id === 19;
      if (fx > ACTIVATE_THRESHOLD) return p.id === 20;
      return false;
    });

    // --- 【同步和弦核心】 ---
    if (player && typeof player.getCurrentTime === 'function' && isVideoPlaying) {
        const videoTime = player.getCurrentTime();
        currentChord = getActiveChord(videoTime, currentMidiData);
    } else {
        currentChord = [60, 64, 67];
    }

    // 更新與繪製
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (myHarp) {
        myHarp.update(smoothFrame, fingerPoints, currentChord, midiOutput);
    }
    
    mySkeleton.draw(canvasCtx, displayLandmarks, canvasElement.width, canvasElement.height, fx);
    myHarp.draw(canvasCtx, smoothFrame, canvasElement.width, canvasElement.height);
    canvasCtx.restore();
  }
}

function lerp(start, end, amt) { return start + (end - start) * amt; }

// --- 5. Window.onload ---
window.onload = () => {
  videoElement = document.querySelector(".input_video");
  canvasElement = document.querySelector(".output_canvas");
  canvasCtx = canvasElement.getContext("2d");
  canvasElement.width = 1280;
  canvasElement.height = 640;

  WebMidi.enable().then(()=>{
    midiOutput = WebMidi.outputs[0];
  });

  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });
  pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  pose.onResults(onResults);

  const camera = new Camera(videoElement, {
    onFrame: async () => { await pose.send({ image: videoElement }); },
    width: 1280, height: 640
  });
  camera.start();
  window.switchSong = async function(selectedSong) {
    if (!selectedSong) return;
    
    console.log("🎵 開始換歌流程：", selectedSong.title);
    const vId = getYoutubeId(selectedSong.youtubeUrl);

    const tryCueVideo = () => {
        if (isPlayerReady && player && typeof player.cueVideoById === 'function') {
            player.cueVideoById(vId);
            console.log("🎬 成功載入影片:", vId);
        } else {
            console.log("⏳ 播放器準備中，0.5秒後重試...");
            setTimeout(tryCueVideo, 500);
        }
    };

    try {
        // 執行 MIDI 解析 (這是你原本 scripts.js 的核心邏輯)
        currentMidiData = await loadAndAnalyzeMidi(selectedSong.url, selectedSong.firstBeatOffset || 0);
        
        // 執行 YouTube 換歌
        tryCueVideo();
    } catch (err) {
        console.error("載入流程錯誤", err);
    }
};

};


//-----------繪圖相關---------//
//繪製debug
function drawDebugAxes(ctx, frame) {
  const scale = 100;
  const cx = frame.center.x * canvasElement.width;
  const cy = frame.center.y * canvasElement.height;

  // 1. 取得單位化的向量
  const magF = Math.hypot(frame.forward2D.x, frame.forward2D.y);
  const fx = frame.forward2D.x / magF;
  const fy = frame.forward2D.y / magF;

  // 2. 計算即時角度 (Yaw)
  // 移除負號，直接根據當前向量計算角度
  const displayYaw = (Math.atan2(fy, fx) * 180 / Math.PI).toFixed(1);

  ctx.save();
  // --- 關鍵修正：將文字座標系翻轉回來 ---
  // 因為整體 Canvas 被 scaleX(-1)，所以我們在文字位置進行反向翻轉
  const textX = 30;
  const textY = 50;

  ctx.translate(canvasElement.width, 0);
  ctx.scale(-1, 1); // 抵消整體的鏡像效果

  // 繪製文字 (注意：現在座標系反了，30 會變成從「右邊」數過來)
  ctx.fillStyle = "white";
  ctx.font = "bold 22px Arial";
  ctx.shadowColor = "black";
  ctx.shadowBlur = 5;
  
  // 修正文字位置，讓它看起來還是在左上角
  ctx.fillText(`Real-time Yaw: ${displayYaw}°`, canvasElement.width - textX - 200, textY);
  ctx.fillText(`Fx : ${fx.toFixed(2)}`,canvasElement.width - textX - 200, textY+30)
  ctx.restore(); // 恢復座標系，確保後面的線條繪製不受影響
  // --- 繪製 Forward (綠線) ---
  // 【修正關鍵】：將 (-fx) 改為 (fx)，讓線條跟隨原始座標邏輯
  ctx.strokeStyle = "green";
  ctx.lineWidth = 4;
  ctx.beginPath(); 
  ctx.moveTo(cx, cy); 
  ctx.lineTo(cx + fx * scale, cy + fy * scale); 
  ctx.stroke();

  // --- 繪製 StringDir (藍線) ---
  const magS = Math.hypot(frame.stringDir2D.x, frame.stringDir2D.y);
  ctx.strokeStyle = "blue";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (frame.stringDir2D.x / magS) * scale, cy + (frame.stringDir2D.y / magS) * scale);
  ctx.stroke();

  ctx.restore();
}
/**
 * 從骨架座標計算豎琴的參考座標系
 * @param {Array} landmarks - MediaPipe 傳回的 33 個基準點
 */
function computeFrameFromPose(landmarks) {
    const p11 = landmarks[11], p12 = landmarks[12], p23 = landmarks[23], p24 = landmarks[24];
    if (!p11 || !p12 || !p23 || !p24) return null;

    // 1. Center: 鎖定在髖部中心並向上偏移 (最穩定的做法)
    const center = {
        x: (p23.x + p24.x) / 2,
        y: (p23.y + p24.y) / 2 - 0.25, // 往上偏移 0.25 讓豎琴浮在胸口
        z: (p23.z + p24.z) / 4
    };

    // 2. 定義兩個向量用於外積計算面朝方向
    // A = 12 -> 11 (肩膀橫向)
    const vA = { x: p11.x - p12.x, y: p11.y - p12.y, z: p11.z - p12.z };
    // B = 12 -> 24 (右側縱向)
    const vB = { x: p24.x - p12.x, y: p24.y - p12.y, z: p24.z - p12.z };

    // 3. 外積計算 (B x A) 得到法向量
    const cross = {
        x: vB.y * vA.z - vB.z * vA.y,
        y: vB.z * vA.x - vB.x * vA.z,
        z: vB.x * vA.y - vB.y * vA.x
    };

    // 4. 將外積結果投影到 2D 平面並單位化，作為 forward2D (面朝向量)
    const magF = Math.hypot(cross.x, cross.y);
    const forward2D = magF < 1e-6 ? { x: 1, y: 0 } : { x: cross.x / magF, y: cross.y / magF };

    // 5. StringDir2D: 琴弦繪製方向 (維持 11&12 中點到 23&24 中點的向量)
    const vS = {
        x: (p23.x + p24.x) / 2 - (p11.x + p12.x) / 2,
        y: (p23.y + p24.y) / 2 - (p11.y + p12.y) / 2
    };
    const magS = Math.hypot(vS.x, vS.y);
    const stringDir2D = magS < 1e-6 ? { x: 0, y: 1 } : { x: vS.x / magS, y: vS.y / magS };

    return { center, forward2D, stringDir2D };
}
// 輔助函式：確保向量長度為 1 (單位化)
function safeNormalize(v) {
    const len = Math.hypot(v.x, v.y);
    return len < 1e-6 ? v : { x: v.x / len, y: v.y / len };
}

