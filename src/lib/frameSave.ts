// Klip Düzenleyici'de oynatma imlecindeki kareyi tam çözünürlükte PNG olarak
// kaydeder. Bilgisayardaki dosyada özgün dosya, linkte önizleme akışı okunur;
// çıktı Resimler\DownKit'e yazılır ve Ekran Görüntüsü kitaplığında görünür.

import i18n from "../i18n";
import { useEditorStore } from "../store/editorStore";
import { player, usePlayerStore } from "../store/playerStore";
import { segmentAt, sourceTimeAt } from "./sequence";
import { currentSegments } from "./sequencePlayer";
import { snipFileName } from "./snip";
import { onShotSaved } from "./snipActions";
import { editorSaveFrame } from "./tauri-api";
import { logEvent } from "./log";

/** İmlecin durduğu kareyi kaydeder; dosya yolunu döner.
 * İmleç bir klibin üstünde değilse (boşluktaysa) yerelleştirilmiş hata atar. */
export async function savePlayheadFrame(): Promise<string> {
  const { source, stream } = useEditorStore.getState();
  if (!source || !stream) throw new Error(i18n.t("editor.frameFailed"));
  // Oynatma durur: imleç sabit kalsın, tam görülen kare alınsın.
  player()?.pause();
  const time = usePlayerStore.getState().currentTime;
  const segment = segmentAt(currentSegments(), time);
  if (!segment) throw new Error(i18n.t("editor.frameEmpty"));
  const seconds = sourceTimeAt(segment, time);
  // HLS listesi aktarıcı üzerinden okunamaz; Rust tarafı kare akışına düşer.
  const input = source.kind === "local" ? source.path : stream.kind === "hls" ? null : stream.url;
  const name = snipFileName(i18n.t("editor.framePrefix"), new Date());
  const path = await editorSaveFrame(stream.token, input, seconds, name);
  logEvent("info", `Kare kaydedildi: ${path}`);
  onShotSaved(path);
  return path;
}
