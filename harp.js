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
    this.handHistory=[];
    this.maxHistory=20;
    this.particles=[];
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
        alpha:1.0,
        life:1.0,
        scale:0.5+Math.random()*0.5
      });
    }
  // 畫十字星 (Star)
  _drawStar(ctx) {
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
      ctx.moveTo(0, -10); ctx.lineTo(0, 10);
      ctx.stroke();
  }

  // 畫圓圈 (Circle)
  _drawCircle(ctx) {
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();
  }

  // 畫方塊 (Square)
  _drawSquare(ctx) {
      ctx.strokeRect(-7, -7, 14, 14);
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
    //2.獨立紀錄軌跡檢查是否有抓到手指，有的話紀錄第一隻手指 (fingerPoints[0])
    if (fingerPoints && fingerPoints.length > 0) {
      const mainFinger = fingerPoints[0]; // 取得陣列中的第一個手指對象
      this.handHistory.push({ x: mainFinger.x, y: mainFinger.y });
      // 限制長度
      if (this.handHistory.length > this.maxHistory) {
        this.handHistory.shift();
      }

      if(this.handHistory.length%5===0){
        const xOffset=canvasWidth/4;
        this.noteAnimation('star',{
          x:mainFinger.x-xOffset,
          y:mainFinger.y
        });
      }
    }
    //particles life
    this.particles.forEach((p,index)=>{
      p.alpha*=0.92;
      p.life-=0.02;
      if(p.alpha<0.01) this.particles.splice(index,1);
    })
  }

  draw(ctx, frame, canvasWidth, canvasHeight) {
    for (let i = 0; i < this.stringCount; i++) {
      const stringIndex = i - Math.floor(this.stringCount / 2);
      const { brightness, offset } = this.strings[i];
      const pos = this._calculateStringPos(frame, stringIndex, offset);

      const r=255;
      const g=255;
      const b = Math.floor(255 * (1-brightness));

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
    // 2. 【在迴圈外面】畫軌跡，這樣軌跡就會在最上層
    if (this.handHistory.length > 5) {
      ctx.save(); // 保護畫布狀態
      const xOffset=canvasWidth/4;
      ctx.beginPath();
      ctx.strokeStyle = "rgba(153, 255, 19, 0.5)"; // 白色半透明軌跡
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = 15;
      ctx.shadowColor = "white";

      // 直接使用 x，不要再乘 canvasWidth
      ctx.moveTo(this.handHistory[0].x + xOffset, this.handHistory[0].y);

      for (let i = 1; i < this.handHistory.length; i++) {
          ctx.lineTo(this.handHistory[i].x + xOffset, this.handHistory[i].y);
      }
      ctx.stroke();
      ctx.restore();  
    }
    //note
    // 在 draw 的結尾
    this.particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y); 
        ctx.scale(p.scale, p.scale);
        ctx.strokeStyle = "#fff41c"; // 統一顏色，也可以存進 p 裡面
        ctx.lineWidth = 2;

        // 根據 type 定義畫法
        switch(p.type) {
            case 'star':
                this._drawStar(ctx);
                break;
            case 'circle':
                this._drawCircle(ctx);
                break;
            case 'square':
                this._drawSquare(ctx);
                break;
        }
        ctx.restore();
    });
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
    }else console.log(`第${index}沒音符`);//可測試和弦完整性

    //visual feedback
    this.strings[index].brightness = 1.0; 
    this.strings[index].offset = (Math.random() - 0.5) * 0.03;
  }
}