import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import {
  DEFAULT_HOTKEYS,
  getRecorderSettings,
  useRecorderSettings,
} from "../../lib/recorderSettings";
import { HotkeyInput } from "./HotkeyInput";

// Windows'a sorma taklidi: Alt+F başka bir programda, gerisi boş.
vi.mock("../../lib/tauri-api", () => ({
  hotkeyProbe: vi.fn(async (list: string[]) => list.map((a) => a !== "Alt+F")),
}));

vi.mock("../../lib/recorder", () => ({
  pauseHotkeys: vi.fn(async () => {}),
  resumeHotkeys: vi.fn(async () => {}),
}));

function open(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function pickKey(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Tuş seç" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("kısayol düzenleyicisi", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("tr");
  });

  beforeEach(() => {
    useRecorderSettings.getState().update({ hotkeys: { ...DEFAULT_HOTKEYS } });
  });

  it("değiştirici ve tuş seçilerek atanır; başka programın tuttuğu Alt+F9 da olur", () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    // Ctrl'yi kaldır: Alt+F9 (NVIDIA'nın kısayolu) kalsın.
    fireEvent.click(screen.getByRole("button", { name: "Ctrl", pressed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(getRecorderSettings().hotkeys.record).toBe("Alt+F9");
  });

  it("listeden başka tuş seçilebilir", () => {
    render(<HotkeyInput id="saveReplay" label="Kaydet" />);
    open("Ctrl + Alt + F10");
    fireEvent.click(screen.getByRole("button", { name: "Shift", pressed: false }));
    pickKey("Num 5");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(getRecorderSettings().hotkeys.saveReplay).toBe("Ctrl+Alt+Shift+Numpad5");
  });

  it("DownKit penceresinde tuşlara basmak da alanları doldurur", () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    fireEvent.keyDown(window, { key: "F8", keyCode: 119, ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(getRecorderSettings().hotkeys.record).toBe("Ctrl+Shift+F8");
  });

  it("Esc vazgeçer, kısayol değişmez", () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    fireEvent.click(screen.getByRole("button", { name: "Shift", pressed: false }));
    fireEvent.keyDown(window, { key: "Escape", keyCode: 27 });
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(getRecorderSettings().hotkeys.record).toBe("Ctrl+Alt+F9");
  });

  it("Alt+F4 ve değiştiricisiz harf kaydedilemez", () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    fireEvent.click(screen.getByRole("button", { name: "Ctrl", pressed: true }));
    pickKey("F4");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Alt", pressed: true }));
    pickKey("Q");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  });

  it("Ctrl+Alt+harf için AltGr uyarısı çıkar ama kaydedilebilir", () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    pickKey("Q");
    expect(screen.getByText(/Ctrl\+Alt\+Q = @/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(getRecorderSettings().hotkeys.record).toBe("Ctrl+Alt+Q");
  });

  it("başka programdaki birleşim uyarıyla kaydedilir, boş öneriler sunulur", async () => {
    render(<HotkeyInput id="record" label="Kayıt" />);
    open("Ctrl + Alt + F9");
    fireEvent.click(screen.getByRole("button", { name: "Ctrl", pressed: true }));
    pickKey("F");
    expect(await screen.findByText(/başka bir program da kullanıyor/)).toBeInTheDocument();
    // Uyarı kaydetmeyi engellemez.
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeEnabled();
    // Öneriye tıklayınca alanlar dolar ve "Boş" yazar.
    fireEvent.click(await screen.findByRole("button", { name: "Ctrl + Shift + F9" }));
    await waitFor(() => expect(screen.getByText(/^Boş:/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(getRecorderSettings().hotkeys.record).toBe("Ctrl+Shift+F9");
  });
});
