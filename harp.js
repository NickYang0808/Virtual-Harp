/**
 * Harp.js - 虛擬豎琴邏輯封裝 (精簡高效穩定版)
 */
class Harp {
  constructor(config = {}) {
    this.stringCount = config.stringCount || 7;
    this.spacing = config.spacing || 0.04;
    this.length = config.length || 0.7;
    this.baseOffset = config.baseOffset || 0.3;
    this.yOffset = config.yOffset || 0;
    this.stringTriggerCooldown = 30;
    this.lastTriggerTime = 0;

    this.initStrings();
  }

  initStrings() {
    this.strings = Array.from({ length: this.stringCount }, () => ({
      brightness: 0,
      offset: 0,
      wasInside: {},
    }));
  }

  setStringCount(count) {
    this.stringCount = count;
    this.initStrings();
  }

  // 尋找給定 X/Y 座標最接近的有效琴弦 (Plucking 掌心定位使用)
  getClosestStringIndex(point, frame) {
    let closest = -1, minDist = 35; // 限制 35px 內才算命中

    for (let i = 0; i < this.stringCount; i++) {
      const pos = this._calculateStringPos(frame, i - Math.floor(this.stringCount / 2), 0);
      const stringX = ((pos.x1 + pos.x2) / 2) * 1280;

      // 檢查 Y 軸是否在琴弦有效長度範圍內
      if (point.y >= (Math.min(pos.y1, pos.y2) - 0.05) * 640 && point.y <= (Math.max(pos.y1, pos.y2) + 0.05) * 640) {
        const dist = Math.abs(point.x - stringX);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
    }
    return closest;
  }

  update(frame, fingerPoints, currentChord) {
    const now = Date.now();
    const canTrigger = now - this.lastTriggerTime > this.stringTriggerCooldown;
    const splitIndex = Math.floor(this.stringCount / 2);
    const margin = Math.max(0.004, this.spacing * 0.4);

    for (let i = 0; i < this.stringCount; i++) {
      this.strings[i].brightness *= 0.85;
      this.strings[i].offset *= 0.6;

      const pos = this._calculateStringPos(frame, i - splitIndex, 0);
      const minX = (Math.min(pos.x1, pos.x2) - margin) * 1280;
      const maxX = (Math.max(pos.x1, pos.x2) + margin) * 1280;
      const minY = (Math.min(pos.y1, pos.y2) - 0.05) * 640;
      const maxY = (Math.max(pos.y1, pos.y2) + 0.05) * 640;

      fingerPoints.forEach((finger) => {
        const id = finger.id || 0;
        // 左右手前後分界過濾
        if ((id === "rightMiddle" && i > splitIndex) || (id === "leftMiddle" && i < splitIndex)) return;

        const isInside = finger.x >= minX && finger.x <= maxX && finger.y >= minY && finger.y <= maxY;

        if (!this.strings[i].wasInside[id] && isInside && canTrigger) {
          this._triggerStrings([i], currentChord);
          this.lastTriggerTime = now;
        }
        this.strings[i].wasInside[id] = isInside;
      });
    }
  }

  draw(ctx, frame, canvasWidth, canvasHeight) {
    const halfCount = Math.floor(this.stringCount / 2);

    for (let i = 0; i < this.stringCount; i++) {
      const { brightness, offset } = this.strings[i];
      const pos = this._calculateStringPos(frame, i - halfCount, offset);

      ctx.beginPath();
      ctx.moveTo(pos.x1 * canvasWidth, pos.y1 * canvasHeight);
      ctx.lineTo(pos.x2 * canvasWidth, pos.y2 * canvasHeight);
      ctx.lineWidth = 1.5 + brightness * 3;
      ctx.strokeStyle = "rgb(255, 255, 255)";

      if (brightness > 0.1) {
        ctx.shadowBlur = 10 * brightness;
        ctx.shadowColor = `rgba(255, 255, 0, ${brightness})`;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }
  }

  _calculateStringPos(frame, index, visualOffset = 0) {
    const px = frame.center.x + frame.forward2D.x * (this.spacing * index + this.baseOffset + visualOffset);
    const py = frame.center.y + frame.forward2D.y * (this.spacing * index + this.baseOffset) + this.yOffset;
    const lenUp = this.length * 0.8;
    const lenDown = this.length * 0.2;

    return {
      x1: px - frame.stringDir2D.x * lenUp + visualOffset * frame.forward2D.y,
      y1: py - frame.stringDir2D.y * lenUp - visualOffset * frame.forward2D.x,
      x2: px + frame.stringDir2D.x * lenDown + visualOffset * frame.forward2D.y,
      y2: py + frame.stringDir2D.y * lenDown - visualOffset * frame.forward2D.x,
    };
  }

  // 單音觸發直接復用多音邏輯
  _triggerString(index, chord) {
    this._triggerStrings([index], chord);
  }

  // 統一琴弦發聲與震動邏輯 (支援單音、雙音合聲)
  _triggerStrings(indices, chord) {
    const notes = mappingToString(chord, this.stringCount);

    indices.forEach((index) => {
      if (index >= 0 && index < this.stringCount) {
        if (notes?.[index]) sendMidiToSynth(notes[index]);
        this.strings[index].brightness = 1.0;
        this.strings[index].offset = (Math.random() - 0.5) * 0.02;
      }
    });
  }
}