/**
 * Harp.js - 虛擬豎琴邏輯封裝 (標準穩定版)
 */
class Harp {
  constructor(config = {}) {
    this.stringCount = config.stringCount || 7;
    this.spacing = config.spacing || 0.02; 
    this.length = config.length || 0.7;    
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
  noteAnimation(type,position){
      this.particles.push({
        type:type,
        x:position.x,
        y:position.y,
        vx: (Math.random() - 0.5) * 4, // 隨機水平速度
        vy: (Math.random() - 0.5) * 4, // 隨機垂直速度
        alpha:1.0,
        life:1.0,
        scale:0.5+Math.random()*0.5
      });
    }
  
  update(frame, fingerPoints, currentChord) {
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
                this._triggerString(i, currentChord);
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

      const r=255;
      const g=255;
      const b=255;

      ctx.beginPath();
      ctx.moveTo(pos.x1 * canvasWidth, pos.y1 * canvasHeight);
      ctx.lineTo(pos.x2 * canvasWidth, pos.y2 * canvasHeight);
      ctx.lineWidth = 1.5 + brightness * 3;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;

      //light
      // 選用：加入發光外框 (Glow)，會讓黃色看起來更像在發亮
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
    const py = frame.center.y + frame.forward2D.y * (this.spacing * index + this.baseOffset);
    // 定義向上與向下的延伸比例 (總長度為 this.length)
    const upRatio = 0.8;   
    const downRatio = 0.2; 
    return {
      // 起點 (x1, y1)：從中心點往「反方向 (上)」延伸 70% 的長度
      x1: (px - frame.stringDir2D.x * (this.length * upRatio)) + visualOffset * frame.forward2D.y,
      y1: (py - frame.stringDir2D.y * (this.length * upRatio)) - visualOffset * frame.forward2D.x,
      
      // 終點 (x2, y2)：從中心點往「正方向 (下)」延伸 30% 的長度
      x2: (px + frame.stringDir2D.x * (this.length * downRatio)) + visualOffset * frame.forward2D.y,
      y2: (py + frame.stringDir2D.y * (this.length * downRatio)) - visualOffset * frame.forward2D.x
    };
  }

  _triggerString(index, chord) {
    //寫和弦四音對應mapping 7弦處
    chord=mappingToString(chord);
    const note = (Array.isArray(chord))?chord[index]:null;

    if(note){
      sendMidiToSynth(note);
      //debug用
      console.log(`撥動${index}弦，音高${note}`);
      //開啟動畫時間
     // this.activeAnimationTime = Date.now();
    }
    //visual feedback
    this.strings[index].brightness = 1.0; 
    this.strings[index].offset = (Math.random() - 0.5) * 0.03;
  }
}