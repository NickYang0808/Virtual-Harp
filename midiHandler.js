/**
 * midiHandler.js - Virtual Harp 音訊與和弦處理大腦
 * 
 * 架構劃分：
 * 1. 樂理常數與預設庫 (Chord Library & Presets)
 * 2. 核心狀態管理器 (State Management - 支援手勢切換與 YouTube 雙模式)
 * 3. 和弦映射與分析 (Mapping & Analysis)
 * 4. MIDI 檔案解析與影音同步 (Tone.js Sync)
 * 5. UI 清單生成 (Playlist UI)
 * 6. Web Audio & Synth 通訊 (Web Audio Engine)
 */
/**
 * midiHandler.js - Virtual Harp 音訊與和弦處理大腦 (精簡高效版)
 */

// ==========================================
// 1. 樂理常數與預設進程庫
// ==========================================

const CHORD_LIBRARY = {};
// 基準設在 C3 ~ B3 (MIDI 48 ~ 59)
["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"].forEach((name, i) => {
  const root = 48 + i;
  CHORD_LIBRARY[name] = [root, root + 4, root + 7];
  CHORD_LIBRARY[`${name}m`] = [root, root + 3, root + 7];
  CHORD_LIBRARY[`${name}7`] = [root, root + 4, root + 7, root + 10];
  // 補上常見升音記號同音異名映射
  const sharpMap = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#" };
  if (sharpMap[name]) {
    CHORD_LIBRARY[sharpMap[name]] = CHORD_LIBRARY[name];
    CHORD_LIBRARY[`${sharpMap[name]}m`] = CHORD_LIBRARY[`${name}m`];
    CHORD_LIBRARY[`${sharpMap[name]}7`] = CHORD_LIBRARY[`${name}7`];
  }
});

const DEFAULT_PRESETS = {
  pop_4536: { name: "流行 4536", progression: ["F", "G", "Em", "Am"] },
  canon_1563: { name: "卡農進行", progression: ["C", "G", "Am", "Em", "F", "C", "F", "G"] },
  jazz_251: { name: "爵士 2-5-1", progression: ["Dm", "G7", "C"] },
  standard: { name: "標準四度進行", progression: ["Am", "Dm", "G7", "C", "F", "Bm", "E7", "Am"] }
};

// ==========================================
// 2. 和弦狀態管理器
// ==========================================

const chordManager = {
  mode: "manual",
  currentProgression: [],
  currentIndex: 0,
  currentNotes: [],
  currentHarpNotes: []
};

function loadPresetProgression(presetKeyOrArray) {
  chordManager.mode = "manual";
  chordManager.currentIndex = 0;
  chordManager.currentProgression = typeof presetKeyOrArray === "string"
    ? (DEFAULT_PRESETS[presetKeyOrArray]?.progression || [])
    : (Array.isArray(presetKeyOrArray) ? presetKeyOrArray : []);

  if (chordManager.currentProgression.length > 0) applyChordByIndex(0);
}

function triggerNextChord() {
  if (chordManager.currentProgression.length === 0) return;
  applyChordByIndex((chordManager.currentIndex + 1) % chordManager.currentProgression.length);
}

function applyChordByIndex(index) {
  chordManager.currentIndex = index;
  const target = chordManager.currentProgression[index];

  chordManager.currentNotes = typeof target === "string"
    ? (CHORD_LIBRARY[target] || [])
    : (target?.notes || (Array.isArray(target) ? target : []));

  const count = (typeof myHarp !== "undefined" && myHarp.stringCount) ? myHarp.stringCount : 7;
  chordManager.currentHarpNotes = mappingToString(chordManager.currentNotes, count);

  if (typeof window.onHarpNotesUpdated === "function") {
    window.onHarpNotesUpdated(chordManager.currentHarpNotes);
  }
}

// ==========================================
// 3. 和弦映射與分析
// ==========================================

function mappingToString(activeNotes, stringCount) {
  const count = typeof stringCount === "number" ? stringCount : (myHarp?.stringCount || 7);
  if (!activeNotes?.length) return new Array(count).fill(null);

  const root = (activeNotes[0] % 12) + 48;
  const isSeventh = activeNotes.length >= 4 && activeNotes[3] - activeNotes[0] !== 12;

  const baseVoicing = isSeventh
    ? [root, activeNotes[1], activeNotes[2], activeNotes[3], root + 12, activeNotes[1] + 12, activeNotes[3] + 12]
    : [root, activeNotes[1], activeNotes[2], root + 12, activeNotes[1] + 12, activeNotes[2] + 12, root + 24];

  return Array.from({ length: count }, (_, i) => 
    baseVoicing[i % baseVoicing.length] + Math.floor(i / baseVoicing.length) * 12
  );
}

function getHarpNotesFromChord(chordInput) {
  return mappingToString(typeof chordInput === "string" ? CHORD_LIBRARY[chordInput] : chordInput);
}

function chordAnalyze(notes) {
  if (!notes?.length) return { name: "N/A", root: null, type: null, intervals: [] };

  const chordMap = {
    "4-7": { l: "", c: 0 }, "4-7-12": { l: "", c: 0 },
    "3-7": { l: "m", c: 1 }, "3-7-12": { l: "m", c: 1 },
    "4-7-10": { l: "7", c: 2 }, "4-7-11": { l: "maj7", c: 3 },
    "3-7-10": { l: "m7", c: 4 }, "2-5-10": { l: "11", c: 5 },
    "4-8": { l: "aug", c: 6 }, "3-6-10": { l: "m7-5", c: 6 }
  };

  const res = chordMap[notes.slice(1).map(n => n - notes[0]).join('-')] || { l: "?", c: -1 };
  return {
    name: ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][notes[0] % 12] + res.l,
    root: notes[0],
    type: res.c,
    intervals: notes.map(n => n - notes[0])
  };
}

// ==========================================
// 4. MIDI 檔案解析與影音同步
// ==========================================

async function loadAndAnalyzeMidi(midiUrl, firstBeatOffset = 0) {
  try {
    const midi = await Midi.fromUrl(midiUrl);
    const bpm = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;
    const activeTrack = midi.tracks.find(t => t.notes.length > 0) || midi.tracks[0];

    const chordGroups = {};
    activeTrack?.notes.forEach(n => {
      const k = n.time.toFixed(3);
      (chordGroups[k] = chordGroups[k] || []).push(n.midi);
    });

    const progression = Object.keys(chordGroups)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map(k => ({
        time: parseFloat(k),
        videoTime: parseFloat(k) + firstBeatOffset,
        notes: chordGroups[k].sort((a, b) => a - b),
      }));

    chordManager.mode = "timeline";
    chordManager.currentProgression = progression;

    console.log(`🎹 MIDI Sync: BPM=${bpm}, 偏移=${firstBeatOffset}s, 和弦數=${progression.length}`);

    return {
      bpm,
      totalMeasures: Math.ceil(midi.duration / ((60 / bpm) * 4)),
      totalNotes: activeTrack?.notes.length || 0,
      hasLeftHand: !!activeTrack?.notes.length,
      progression,
      firstBeatOffset,
      rawMidi: midi,
    };
  } catch (err) {
    console.error("MIDI 整合解析失敗:", err);
    throw err;
  }
}

function getActiveChord(currentTime = null, midiData = null) {
  if (chordManager.mode === "manual" || currentTime === null) return chordManager.currentNotes;

  const prog = midiData?.progression || chordManager.currentProgression;
  if (!prog?.length) return [];

  for (let i = prog.length - 1; i >= 0; i--) {
    if (currentTime >= prog[i].videoTime) {
      return (chordManager.currentNotes = prog[i].notes);
    }
  }
  return [];
}

// ==========================================
// 5. UI 清單初始化
// ==========================================

function initMidiUI(containerElement, songData) {
  if (!containerElement) return;
  containerElement.innerHTML = "";

  songData.forEach((song) => {
    const item = document.createElement("div");
    item.className = "playlist-item";
    item.textContent = song.title;
    item.onclick = () => {
      containerElement.querySelectorAll(".playlist-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      window.switchSong?.(song);
    };
    containerElement.appendChild(item);
  });
}

// ==========================================
// 6. 音訊引擎與發聲通訊
// ==========================================

let ctx, ctxStart = false, midi_synth;

async function initAudio() {
  if (!ctxStart) {
    ctx = new AudioContext();
    midi_synth = new window.MidiSynth();
    midi_synth.setAudioContext(ctx, ctx.destination);
    ctxStart = true;

    if (typeof midi_synth.enableRoutingComposer === "function") {
      await midi_synth.enableRoutingComposer({
        button: '#open-composer-btn',
        target: '#composer-slot',
        tailwind: 'auto',
      });
    }
  } else if (ctx.state === "suspended") {
    ctx.resume();
  }
  window.synth = midi_synth;
}

document.addEventListener("click", initAudio);
document.addEventListener("touchstart", initAudio);

function sendMidiToSynth(midiNote, velocity = 100) {
  if (ctx && window.synth?.send) {
    try {
      if (ctx.state === "suspended") ctx.resume();
      window.synth.send([0x90, midiNote, velocity], 0);
    } catch (e) {
      console.warn("Synth 發聲攔截:", e);
    }
  }
}

// ==========================================
// 7. 自動和弦節拍器
// ==========================================

let autoChordTimer = null;

function startAutoChord(bpm = 60, beats = 4) {
  stopAutoChord();
  const intervalMs = (60 / bpm) * beats * 1000;
  console.log(`⏱️ 自動和弦啟動: BPM=${bpm}, 每 ${beats} 拍 (${(intervalMs / 1000).toFixed(2)}s) 切換`);
  autoChordTimer = setInterval(triggerNextChord, intervalMs);
}

function stopAutoChord() {
  if (autoChordTimer) {
    clearInterval(autoChordTimer);
    autoChordTimer = null;
    console.log("⏹️ 自動和弦已停止");
  }
}