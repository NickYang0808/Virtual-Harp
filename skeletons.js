class Skeleton {
  constructor(config = {}) {
    this.color = config.color || "#00FF00";
    this.lineWidth = config.lineWidth || 2;
    // 定義骨架連線順序
    this.connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // 手臂
      [11, 23], [12, 24], [23, 24],                   // 軀幹
      [23, 25], [24, 26], [25, 27], [26, 28]            // 腿部
    ];
  }

  draw(ctx, landmarks, width, height, fx = 0) {
    if (!landmarks || landmarks.length === 0) return;
    
    // 確保寬高有效，否則畫不出來
    const w = width || 1280;
    const h = height || 640;

    ctx.save();
    
    // --- 1. 軀幹連線 ---
    ctx.strokeStyle = this.color || "white";
    ctx.lineWidth = this.lineWidth || 2;
    if (this.connections) {
      this.connections.forEach(([i, j]) => {
        const s = landmarks[i];
        const e = landmarks[j];
        if (s && e && s.visibility > 0.5) { // 軀幹要求高一點
          ctx.beginPath();
          ctx.moveTo(s.x * w, s.y * h);
          ctx.lineTo(e.x * w, e.y * h);
          ctx.stroke();
        }
      });
    }

    // --- 2. Head (臉部) ---
    // 註解：如果還是沒出現，代表 landmarks[0-10] 的數據可能沒被平滑處理到
    // --- 修正後的 Head 區塊 ---
        // 0:鼻, 2:左眼, 5:右眼, 7:左耳, 8:右耳 (這是最穩定的點)
        const headPoints = [8, 5, 2, 7]; // 簡單畫一條橫跨頭部的線
        
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"; 
        ctx.lineWidth = 3;

        // 畫一個圈代表頭
        const nose = landmarks[0];
        if (nose) {
            ctx.beginPath();
            ctx.arc(nose.x * width, nose.y * height, 25, 0, Math.PI * 2);
            ctx.stroke();
            
            // 畫一個實心小點當鼻子
            ctx.fillStyle = "white";
            ctx.fill();
        }

        // 畫眼睛連線 (Index 2 和 5)
        if (landmarks[2] && landmarks[5]) {
            ctx.beginPath();
            ctx.moveTo(landmarks[2].x * width, landmarks[2].y * height);
            ctx.lineTo(landmarks[5].x * width, landmarks[5].y * height);
            ctx.stroke();
        }

    // --- 3. Palm (手掌) ---
    // 註解：檢查 landmarks[15] 到 [22] 是否存在
    const handPaths = [[15, 17, 19, 15], [15, 21], [16, 18, 20, 16], [16, 22]];
    ctx.strokeStyle = "rgba(0, 255, 255, 0.8)"; // 暫時改成青藍色，方便你辨認有沒有畫出來
    handPaths.forEach(path => {
      ctx.beginPath();
      let started = false;
      path.forEach(idx => {
        const p = landmarks[idx];
        if (p) {
          if (!started) { ctx.moveTo(p.x * w, p.y * h); started = true; }
          else ctx.lineTo(p.x * w, p.y * h);
        }
      });
      ctx.stroke();
    });

    // --- 4. Hand 紅綠點 ---
    // 註解：這裡使用了 smoothFrame.forward2D.x，請確保 smoothFrame 是全域變數
    const handIndices = [19, 20];
    const ACTIVATE_THRESHOLD = 0.98;

    handIndices.forEach(index => {
      const p = landmarks[index];
      if (p) {
        // 直接從全域取的 fx 比較保險
        const currentFx = (typeof smoothFrame !== 'undefined') ? smoothFrame.forward2D.x : fx;
        const color = (index === 19) ? "#FF0000" : "#00FF00";
        
        let shouldDraw = false;
        if (currentFx < -ACTIVATE_THRESHOLD && index === 19) shouldDraw = true;
        else if (currentFx > ACTIVATE_THRESHOLD && index === 20) shouldDraw = true;

        if (shouldDraw) {
          ctx.save();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "white";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }
      }
    });

    ctx.restore();
  }
}