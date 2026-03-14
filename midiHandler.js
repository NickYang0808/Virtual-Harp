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
/**
 * Mapping to String
 */
function mappingToString(activeNotes) {
  if (!activeNotes || activeNotes.length === 0) return new Array(7).fill(null);

  // 1. 獲取分析與對齊後的根音 (延續你剛才的 45~57 邏輯)
  const analysis = chordAnalyze(activeNotes);
  const newRoot = (analysis.root % 12) + 48; // 強制 C 落在 48
  const intervals = analysis.intervals;      // 相對音程 [0, 4, 7, 11...]

  // 2. 準備這 7 根弦的容器
  let finalHarpNotes = [];

  // --- 填充策略 ---
  // 第 1 弦：固定的低音根音
  finalHarpNotes[0] = newRoot;

  // 第 2, 3, 4 弦：其餘的和聲組成音 (intervals[1], [2], [3]...)
  for (let i = 1; i <= 3; i++) {
    // 預防 intervals 長度不足 (例如只有 3 個音的和弦)
    const idx = i < intervals.length ? i : (i % (intervals.length - 1)) + 1;
    finalHarpNotes[i] = newRoot + intervals[idx];
  }

  // 第 5, 6, 7 弦：將 2, 3, 4 弦的音往上加一個八度 (+12)
  for (let i = 4; i <= 6; i++) {
    finalHarpNotes[i] = finalHarpNotes[i - 3] + 12;
  }
  return finalHarpNotes; 
}
/**
 * 和弦分析核心：回傳結構化資料
 */
function chordAnalyze(notes) {
  if (!notes || notes.length === 0) return { name: "N/A", root: null, type: null, intervals: [] };

  const root = notes[0];
  const rootName = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][root % 12];
  const intervalStr = notes.slice(1).map(n => n - root).join('-');

  // 定義屬性資料庫 (代碼：0=Major, 1=Minor, 2=7, 3=maj7, 4=m7, 5=sus...)
  const chordMap = {
    "4-7":    { label: "",      class: 0 },
    "4-7-12": { label: "",      class: 0 },
    "3-7":    { label: "m",     class: 1 },
    "3-7-12": { label: "m",     class: 1 },
    "4-7-10": { label: "7",     class: 2 },
    "4-7-11": { label: "maj7",  class: 3 },
    "3-7-10": { label: "m7",    class: 4 },
    "2-5-10": { label: "11",    class: 5 }, // 簡化標記為 11
    "4-8":    { label: "aug",   class: 6 },
    "3-6-10": { label: "m7-5",  class: 6}
  };

  const result = chordMap[intervalStr] || { label: "?", class: -1 };

  return {
    name: rootName + result.label, // 用於 Monitor (C, Am7...)
    root: root,                    // 用於 Calculate (MIDI 60)
    type: result.class,            // 用於 Calculate (數字類別)
    intervals: notes.map(n => n - root) // 相對音程陣列
  };
}

//sendMidi
/**
 * 轉接器：將撥弦事件送往學長的 Web Synth velocity暫定調整
 */
let ctx;
let ctxStart = false;
let midi_synth;

async function initAudio() {
  if (!ctxStart) {
    // ⚡ Create AudioContext only after first user interaction
    ctx = new AudioContext();
    midi_synth = new window.MidiSynth();
    midi_synth.setAudioContext(ctx, ctx.destination);
    ctxStart = true;
    console.log("AudioContext 1.0 started:", ctx);

    // ✅ This function exists only in the GUI version
    if (typeof midi_synth.enableRoutingComposer === "function") {
      await midi_synth.enableRoutingComposer({
        button: '#open-composer-btn',
        target: '#composer-slot',
        tailwind: 'auto',
      });
    } else {
      console.log("Non-GUI version detected, skipping Routing Composer setup.");
    }

  } else if (ctx.state === "suspended") {
    ctx.resume().then(() => {
      console.log("AudioContext resumed");
    });
  }
  window.synth = midi_synth;//global virabale
}
document.addEventListener("click", initAudio, { once: false });
document.addEventListener("touchstart", initAudio, { once: false });

function sendMidiToSynth(midiNote, velocity = 100) {
    if (window.synth && typeof window.synth.send === 'function') {

      window.synth.send([0x90,midiNote,velocity],0);

    } else {
        console.warn("Synth 尚未初始化或無法連線");
    }
}