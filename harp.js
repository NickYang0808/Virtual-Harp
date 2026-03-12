/**
 * Harp.js - 虛擬豎琴邏輯封裝 (標準穩定版)
 */
class Harp {
  constructor(config = {}) {
    this.stringCount = config.stringCount || 7;
    this.spacing = config.spacing || 0.02; 
    this.length = config.length || 0.5;    
    this.baseOffset = config.baseOffset || 0.15; // 固定距離
    this.hitboxMargin = 0.02;
    this.stringTriggerCooldown = 30;
    this.lastTriggerTime = 0;

    this.strings = Array.from({ length: this.stringCount }, () => ({
      brightness: 0,
      offset: 0,
      wasInside: {} 
    }));
  }

  update(frame, fingerPoints, currentChord, midiOutput) {
    const now = Date.now();
    const canTrigger = now - this.lastTriggerTime > this.stringTriggerCooldown;

    for (let i = 0; i < this.stringCount; i++) {
        this.strings[i].brightness *= 0.85;
        this.strings[i].offset *= 0.6;

        const stringIndex = i - Math.floor(this.stringCount / 2);
        const pos = this._calculateStringPos(frame, stringIndex, 0);
        
        const hitbox = {
            minX: (Math.min(pos.x1, pos.x2) - this.hitboxMargin) * 1280,
            maxX: (Math.max(pos.x1, pos.x2) + this.hitboxMargin) * 1280,
            minY: (Math.min(pos.y1, pos.y2) - 0.05) * 640,
            maxY: (Math.max(pos.y1, pos.y2) + 0.05) * 640
        };

        fingerPoints.forEach(finger => {
            const isInside = finger.x >= hitbox.minX && finger.x <= hitbox.maxX && 
                             finger.y >= hitbox.minY && finger.y <= hitbox.maxY;
            const fingerID = finger.id || 0;

            if (!this.strings[i].wasInside[fingerID] && isInside && canTrigger) {
                this._triggerString(i, currentChord, midiOutput);
                this.lastTriggerTime = now;
            }
            this.strings[i].wasInside[fingerID] = isInside;
        });
    }
  }

  draw(ctx, frame, canvasWidth, canvasHeight) {
    for (let i = 0; i < this.stringCount; i++) {
      const stringIndex = i - Math.floor(this.stringCount / 2);
      const { brightness, offset } = this.strings[i];
      const pos = this._calculateStringPos(frame, stringIndex, offset);

      const colorValue = Math.floor(100 + brightness * 155);
      ctx.beginPath();
      ctx.moveTo(pos.x1 * canvasWidth, pos.y1 * canvasHeight);
      ctx.lineTo(pos.x2 * canvasWidth, pos.y2 * canvasHeight);
      ctx.lineWidth = 2.2 + brightness * 4;
      ctx.strokeStyle = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;
      ctx.stroke();
    }
  }

  _calculateStringPos(frame, index, visualOffset = 0) {
    const px = frame.center.x + frame.forward2D.x * (this.spacing * index + this.baseOffset + visualOffset);
    const py = frame.center.y + frame.forward2D.y * (this.spacing * index + this.baseOffset);

    return {
      x1: (px - frame.stringDir2D.x * this.length / 2) + visualOffset * frame.forward2D.y,
      y1: (py - frame.stringDir2D.y * this.length / 2) - visualOffset * frame.forward2D.x,
      x2: (px + frame.stringDir2D.x * this.length / 2) + visualOffset * frame.forward2D.y,
      y2: (py + frame.stringDir2D.y * this.length / 2) - visualOffset * frame.forward2D.x
    };
  }

  _triggerString(index, chord, output) {
    //寫和弦四音對應mapping 7弦處
    const note = (chord && chord.notes) ? chord.notes[index] : null;

    if(note){
      sendMidiToSynth(note);
      //debug用
      if (output && note) output.playNote(note, 1, { duration: 500 }); 
    }
    //visual feedback
    this.strings[index].brightness = 1.0; 
    this.strings[index].offset = (Math.random() - 0.5) * 0.06;
  }
}