// 入口：在瀏覽器環境把 Phaser 掛到 #app。呈現層的實作全在 src\render\ 之下。
export const APP_NAME = 'Arcanopolis';

/** 掛載點 id，與 index.html 的 <div id="app"> 對應。 */
export const MOUNT_ID = 'app';

// Phaser 走動態 import：本檔會被 node 環境的測試 import（取 APP_NAME），
// 而 Phaser 需要 DOM，靜態 import 會讓那些測試在載入階段就炸。
if (typeof document !== 'undefined') {
  import('./render/game')
    .then(({ createGame }) => {
      createGame(MOUNT_ID);
    })
    .catch((error: unknown) => {
      console.error('[Arcanopolis] 啟動失敗', error);
      const mount = document.getElementById(MOUNT_ID);
      if (mount) {
        mount.textContent = `啟動失敗：${error instanceof Error ? error.message : String(error)}`;
        (mount as HTMLElement).style.color = '#d95763';
      }
    });
}
