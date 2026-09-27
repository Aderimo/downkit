import { describe, expect, it } from "vitest";
import { placeCard, unionRect, useTutorialStore } from "./tutorial";
import { normalizeSettings, useSettingsStore } from "./appSettings";

const viewport = { width: 1100, height: 700 };
const card = { width: 380, height: 260 };

describe("tanıtım turu", () => {
  it("kart vurgulanan menü öğesinin sağında ve dikeyde ortalı durur", () => {
    const target = { left: 16, top: 300, width: 208, height: 40 };
    expect(placeCard(target, card, viewport)).toEqual({ left: 244, top: 190, side: "right" });
  });

  it("alt köşedeki öğede kart ekrandan taşmaz", () => {
    const maker = { left: 16, top: 560, width: 208, height: 130 };
    const placed = placeCard(maker, card, viewport);
    expect(placed.side).toBe("right");
    expect(placed.top + card.height).toBeLessThanOrEqual(viewport.height - 16);
  });

  it("hedef yoksa ya da sağda yer kalmazsa kart ortalanır", () => {
    expect(placeCard(null, card, viewport).side).toBe("center");
    const wide = { left: 0, top: 0, width: 1000, height: 650 };
    expect(placeCard(wide, card, viewport).side).toBe("center");
  });

  it("birden çok öğe tek alanda birleşir", () => {
    expect(
      unionRect([
        { left: 16, top: 100, width: 200, height: 40 },
        { left: 16, top: 220, width: 208, height: 40 },
      ]),
    ).toEqual({ left: 16, top: 100, width: 208, height: 160 });
    expect(unionRect([])).toBeNull();
  });

  it("eski ayar kaydında tur açık gelir, kapatılmışsa kapalı kalır", () => {
    expect(normalizeSettings({}).showTutorial).toBe(true);
    expect(normalizeSettings({ showTutorial: false }).showTutorial).toBe(false);
  });
});

describe("tur tercihleri", () => {
  it("'Bir daha gösterme' işaretlenir işaretlenmez kaydedilir ve sayfa turlarını da kapatır", () => {
    useSettingsStore.getState().update({ showTutorial: true, pageTours: true });
    const tour = useTutorialStore.getState();
    tour.start("welcome");
    tour.setDontShowAgain(true);
    // Tur kapatılmadan (ör. program kapanırsa) bile kaydedilmiş olmalı.
    expect(useSettingsStore.getState().showTutorial).toBe(false);
    expect(useSettingsStore.getState().pageTours).toBe(false);
    expect(JSON.parse(localStorage.getItem("downkit.settings") ?? "{}").showTutorial).toBe(false);
    useTutorialStore.getState().close();
    expect(useSettingsStore.getState().showTutorial).toBe(false);
  });

  it("işaretlenmeden kapatılan karşılama turu sonraki açılışta yine gelir", () => {
    useSettingsStore.getState().update({ showTutorial: true, pageTours: true });
    useTutorialStore.getState().start("welcome");
    useTutorialStore.getState().close();
    expect(useSettingsStore.getState().showTutorial).toBe(true);
  });

  it("sayfa turu açıldığı an görüldü sayılır", () => {
    useTutorialStore.getState().resetSeen();
    useTutorialStore.getState().start("record");
    expect(useTutorialStore.getState().seen).toContain("record");
    useTutorialStore.getState().close();
  });
});
