// roll.js

// roll.js

function initPlaylist(songs) {
  const playlistContainer = document.getElementById("songList");
  if (!playlistContainer) return;

  playlistContainer.innerHTML = "";

  songs.forEach((song) => {
    const item = document.createElement("div");
    item.className = "playlist-item";
    item.innerText = song.title;

    item.onclick = function () {
      console.log("🎯 選中歌曲：", song.title);

      // UI 樣式切換
      document
        .querySelectorAll(".playlist-item")
        .forEach((el) => el.classList.remove("active"));
      this.classList.add("active");

      // 呼叫 scripts.js 裡整合好的換歌邏輯
      if (typeof window.switchSong === "function") {
        window.switchSong(song);
      }
    };

    playlistContainer.appendChild(item);
  });
}

// 監聽載入，執行初始化
document.addEventListener("DOMContentLoaded", () => {
  if (typeof IMUSE_SONGS !== "undefined") {
    initPlaylist(IMUSE_SONGS);
  }
});
