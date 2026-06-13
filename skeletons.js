class Skeleton {
  constructor(config = {}) {
    this.color = config.color || "#00FF00";
    this.lineWidth = config.lineWidth || 2;
    // 定義骨架連線順序
    this.connections = [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16], // 手臂
      [11, 23],
      [12, 24],
      [23, 24], // 軀幹
      [23, 25],
      [24, 26],
      [25, 27],
      [26, 28], // 腿部
    ];
    this.handConnections = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [0, 17],
      [17, 18],
      [18, 19],
      [19, 20],
    ];
  }

  draw(ctx, landmarks, width, height, fx = 0, handLandmarks = null) {
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
        if (s && e && s.visibility > 0.5) {
          // 軀幹要求高一點
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
      ctx.arc(nose.x * width, nose.y * height, 10, 0, Math.PI * 2);
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
    const handConnections = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [0, 17],
      [17, 18],
      [18, 19],
      [19, 20],
    ];

    const poseLeftWrist = landmarks[15];
    const poseRightWrist = landmarks[16];

    const distance2 = (a, b) => {
      if (!a || !b) return Infinity;

      const dx = a.x - b.x;
      const dy = a.y - b.y;

      return dx * dx + dy * dy;
    };

    const currentFx =
      typeof smoothFrame !== "undefined" && smoothFrame.forward2D
        ? smoothFrame.forward2D.x
        : fx;

    const ACTIVATE_THRESHOLD = 0.98;

    let hasDrawnHands = false;

    if (handLandmarks && handLandmarks.length > 0) {
      handLandmarks.forEach((hand) => {
        if (!hand || !hand[0]) return;

        const handWrist = hand[0];

        const dLeft = distance2(handWrist, poseLeftWrist);
        const dRight = distance2(handWrist, poseRightWrist);

        const isLeftHand = dLeft < dRight;
        const targetWrist = isLeftHand ? poseLeftWrist : poseRightWrist;

        if (!targetWrist) return;

        hasDrawnHands = true;

        const offsetX = targetWrist.x - handWrist.x;
        const offsetY = targetWrist.y - handWrist.y;

        ctx.strokeStyle = "rgba(0, 255, 255, 0.85)";
        ctx.lineWidth = 3;

        handConnections.forEach(([i, j]) => {
          const a = hand[i];
          const b = hand[j];

          if (!a || !b) return;

          ctx.beginPath();
          ctx.moveTo((a.x + offsetX) * w, (a.y + offsetY) * h);
          ctx.lineTo((b.x + offsetX) * w, (b.y + offsetY) * h);
          ctx.stroke();
        });

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

        hand.forEach((p, index) => {
          if (!p) return;

          ctx.beginPath();
          ctx.arc(
            (p.x + offsetX) * w,
            (p.y + offsetY) * h,
            index === 0 ? 6 : 4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        });

        // --- 4. Hand 紅綠點，優先畫在 Hands 的食指尖 ---
        const fingerTip = hand[8];

        if (fingerTip) {
          let shouldDraw = false;
          let color = "white";

          if (currentFx < -ACTIVATE_THRESHOLD && isLeftHand) {
            shouldDraw = true;
            color = "#FF0000";
          } else if (currentFx > ACTIVATE_THRESHOLD && !isLeftHand) {
            shouldDraw = true;
            color = "#00FF00";
          }

          if (shouldDraw) {
            ctx.save();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(
              (fingerTip.x + offsetX) * w,
              (fingerTip.y + offsetY) * h,
              15,
              0,
              Math.PI * 2,
            );
            ctx.fill();

            ctx.strokeStyle = "white";
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
          }
        }
      });
    }
    ctx.restore();
  }
}
