import { describe, expect, it } from "vitest";
import { bookmarklet, parseDeepLink } from "./deepLink";

describe("tarayıcıdan gönderme", () => {
  it("open ve edit bağlantıları çözülür", () => {
    const url = "https://www.youtube.com/watch?v=abc&t=10";
    expect(parseDeepLink(`downkit://open?url=${encodeURIComponent(url)}`)).toEqual({
      action: "open",
      url,
    });
    expect(parseDeepLink(`downkit://edit?url=${encodeURIComponent(url)}`)?.action).toBe("edit");
  });

  it("başka şema ya da http olmayan adres reddedilir", () => {
    expect(parseDeepLink("https://open?url=https://x.com")).toBeNull();
    expect(parseDeepLink("downkit://open?url=file:///C:/Windows")).toBeNull();
    expect(parseDeepLink("downkit://open")).toBeNull();
    expect(parseDeepLink("bozuk")).toBeNull();
  });

  it("yer imi kodu sayfa adresini kodlayarak gönderir", () => {
    expect(bookmarklet("edit")).toBe(
      "javascript:void(location.href='downkit://edit?url='+encodeURIComponent(location.href))",
    );
  });
});
