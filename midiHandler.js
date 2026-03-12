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
      if (typeof window.switchSong === "function") {
        window.switchSong(song);
      }else{
        console.error("找不到switchSog韓式");
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

    // --- B. 簡化判定：抓取第一個有音符的軌道 ---
    // 不再過濾名稱，直接找第一個 notes.length > 0 的軌道
    const activeTrack = midi.tracks.find((t) => t.notes.length > 0) || midi.tracks[0];
    const totalNotes = activeTrack ? activeTrack.notes.length : 0;
    const hasLeftHand = totalNotes > 0; // 為了不改動後續 scripts.js 呼叫，保留名稱但邏輯改為「是否有音符」

    // --- C. 提取和弦序列並計算影片對齊時間 ---
    const chordGroups = {};
    if (activeTrack) {
      activeTrack.notes.forEach((note) => {
        // 原有的 MIDI 時間戳記
        const timeKey = note.time.toFixed(3);
        if (!chordGroups[timeKey]) chordGroups[timeKey] = [];
        chordGroups[timeKey].push({
          name: note.name,
          midi: note.midi,
        });
      });
    }

    // 轉換為陣列格式
    const progression = Object.keys(chordGroups)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map((timeStr) => {
        const midiTime = parseFloat(timeStr);

        const sortedNotes=chordGroups[timeStr]
          .map(n=>n.midi)
          .sort((a,b)=>a-b);

        return {
          time: midiTime,
          videoTime: midiTime + firstBeatOffset,
          notes: sortedNotes,
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
      `- 狀態判定: ${hasLeftHand ? "✅ 軌道解析成功" : "❌ 無有效音符"}`,
    );
    console.log(`音符總數：${totalNotes},小節總數：${totalMeasures}`);
    console.log(
      `- 第一個和弦影片觸發點: ${progression.length > 0 ? progression[0].videoTime.toFixed(2) : "N/A"} 秒`,
    );

    return {
      bpm,
      totalMeasures,
      totalNotes,
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
  
  if (!midiData || !midiData.progression) return [];

  // 2. 尋找當前時間對應的和弦
  // 邏輯：從後往前找，找到第一個 videoTime 小於等於當前時間的點
  const active = [...midiData.progression]
    .reverse()
    .find((p) => currentTime >= p.videoTime);

  // 3. 如果找到了就回傳 notes，沒找到就回傳預設
  return active ? active.notes : [];
}
/**
 * 簡易和弦分析 (針對根音位置 MIDI)
 * @param {Array} notes - 已排序的 MIDI 編號陣列
 * @returns {string} - 和弦名稱 (例如 "C Major")
 */
function chordAnalyze(notes) {
  if (!notes || notes.length < 2) return "";

  const root = notes[0];
  const rootName = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][root % 12];

  // 計算所有音符相對於根音的半音距離
  // 例如 [60, 64, 67, 72] 會變成 "4-7-12"
  const intervals = notes.slice(1).map(n => n - root).join('-');

  switch (intervals) {
    case "4-7-12": // 跟音、大三度、五度、八度
      return `${rootName}`;
      
    case "3-7-12": // 跟音、小三度、五度、八度
      return `${rootName}m`;
      
    case "4-7-11": // 跟音、大三度、五度、大七度
      return `${rootName}maj7`;
      
    case "3-7-10": // 跟音、小三度、五度、小七度
      return `${rootName}m7`;
      
    case "4-7-10": // 跟音、大三度、五度、小七度
      return `${rootName}7`;
    case "2-5-10": // 跟音、大三度、五度、小七度
      return `${rootName}9sus4`;


    // 如果之後有 3 音的和弦 (無八度) 也可以在這邊補
    case "4-7": 
      return `${rootName}`;
    case "3-7":
      return `${rootName}m`;
    case "4-8":
      return `${rootName}aug`;

      
    default:
      return `${rootName}?`; // 若不符合上述規則，僅顯示根音名稱
  }
}