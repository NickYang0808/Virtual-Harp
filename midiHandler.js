/**
 * midiHandler.js - MIDI 處理大腦 (整合解析、BPM計算、和弦提取)
 */

// 1. 初始化選單 (讓 scripts.js 呼叫)
function initMidiUI(containerElement, songData) {
  if (!containerElement) return;

  // 清空舊的內容
  containerElement.innerHTML = "";

  songData.forEach((song) => {
    // 改成建立 div 而不是 option
    const item = document.createElement("div");
    item.className = "playlist-item";
    item.textContent = song.title;

    // 儲存 midi url 到 dataset，方便之後讀取
    item.dataset.url = song.url;

    // 點擊事件處理
    item.onclick = () => {
      document
        .querySelectorAll(".playlist-item")
        .forEach((el) => el.classList.remove("active"));
      item.classList.add("active");

      // 觸發你的 midi 載入邏輯 (假設叫 loadMidi)
      if (typeof loadMidi === "function") {
        loadMidi(song.url);
      }
    };

    containerElement.appendChild(item);
  });
}
/**
 * 載入並解析 MIDI，並針對 YouTube 影片時間進行對齊
 * @param {string} midiUrl - MIDI 檔案路徑
 * @param {number} firstBeatOffset - 手動設定的第一拍偏移量 (秒)
 */
async function loadAndAnalyzeMidi(midiUrl, firstBeatOffset = 0) {
  try {
    // 使用 ToneJS Midi 載入
    const midi = await Midi.fromUrl(midiUrl);

    // --- A. 解析基礎資訊 ---
    const bpm =
      midi.header.tempos.length > 0
        ? Math.round(midi.header.tempos[0].bpm)
        : 120;
    const secondsPerMeasure = (60 / bpm) * 4; // 假設 4/4 拍
    const totalMeasures = Math.ceil(midi.duration / secondsPerMeasure);

    // --- B. 尋找左手軌道與判定 ---
    const leftTrack =
      midi.tracks.find(
        (t) =>
          t.name.toLowerCase().includes("left") ||
          t.name.toLowerCase().includes("bass") ||
          t.name.toLowerCase().includes("l.h"),
      ) ||
      midi.tracks[1] ||
      midi.tracks[0];

    const hasLeftHand = leftTrack && leftTrack.notes.length > 0;

    // --- C. 提取和弦序列並計算影片對齊時間 ---
    const chordGroups = {};
    if (leftTrack) {
      leftTrack.notes.forEach((note) => {
        // 原有的 MIDI 時間戳記
        const timeKey = note.time.toFixed(3);
        if (!chordGroups[timeKey]) chordGroups[timeKey] = [];
        chordGroups[timeKey].push({
          name: note.name,
          midi: note.midi,
          velocity: note.velocity,
        });
      });
    }

    // 轉換為陣列格式
    const progression = Object.keys(chordGroups)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map((timeStr) => {
        const midiTime = parseFloat(timeStr);
        return {
          time: midiTime,
          // 重要：算出在 YouTube 影片中對應出現的絕對秒數
          videoTime: midiTime + firstBeatOffset,
          notes: chordGroups[timeStr].map((n) => n.midi),
        };
      });

    // --- D. Console 測試輸出 ---
    console.log(
      `%c🎹 MIDI & Video Sync Report`,
      "color: #00FF00; font-weight: bold; font-size: 14px;",
    );
    console.log(`- 歌曲名稱: ${midi.name || "Unknown"}`);
    console.log(`- BPM: ${bpm} (每小節 ${secondsPerMeasure.toFixed(2)} 秒)`);
    console.log(`- 第一拍偏移 (Offset): ${firstBeatOffset} 秒`);
    console.log(
      `- 左手判定: ${hasLeftHand ? "✅ 已同步和弦" : "❌ 無和弦軌 (預設 C)"}`,
    );
    console.log(
      `- 第一個和弦影片觸發點: ${progression.length > 0 ? progression[0].videoTime.toFixed(2) : "N/A"} 秒`,
    );

    return {
      bpm,
      totalMeasures,
      hasLeftHand,
      progression, // 內含 videoTime 供同步使用
      firstBeatOffset,
      rawMidi: midi,
    };
  } catch (err) {
    console.error("MIDI 整合解析失敗:", err);
    throw err;
  }
}

/**
 * 根據目前時間，從 progression 中抓取應該演奏的和弦
 * @param {number} currentTime - 影片或節拍器的當前秒數
 * @param {Object} midiData - loadAndAnalyzeMidi 回傳的整包資料
 * @returns {Array} - MIDI 編號陣列 (例如 [60, 64, 67])
 */
function getActiveChord(currentTime, midiData) {
  // 1. 如果沒資料、沒左手、或是影片沒在跑，回傳預設 C 和弦
  if (!midiData || !midiData.hasLeftHand || !midiData.progression) {
    return [60, 64, 67]; // 預設 C Major
  }

  // 2. 尋找當前時間對應的和弦
  // 邏輯：從後往前找，找到第一個 videoTime 小於等於當前時間的點
  const active = [...midiData.progression]
    .reverse()
    .find((p) => currentTime >= p.videoTime);

  // 3. 如果找到了就回傳 notes，沒找到就回傳預設
  return active ? active.notes : [60, 64, 67];
}
