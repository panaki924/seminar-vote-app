import { describe, expect, it } from "vitest";
import { buildVoteUrl, isUnreachableBase, normalizeBaseUrl } from "./qr-links";

describe("normalizeBaseUrl", () => {
  it("先頭の部分(https://ホスト名)だけにそろえる(末尾の / やパスは取り除く)", () => {
    expect(normalizeBaseUrl("https://seminar-vote.vercel.app")).toBe("https://seminar-vote.vercel.app");
    expect(normalizeBaseUrl("  https://seminar-vote.vercel.app/  ")).toBe("https://seminar-vote.vercel.app");
    expect(normalizeBaseUrl("https://seminar-vote.vercel.app/admin/qr?x=1")).toBe("https://seminar-vote.vercel.app");
  });
  it("http(s) 以外・読み取れないものは null", () => {
    for (const bad of ["", "vercel.app", "ftp://x.example", "javascript:alert(1)", "not a url"]) expect(normalizeBaseUrl(bad)).toBeNull();
  });
});

describe("buildVoteUrl", () => {
  it("<先頭>/v/<トークン> の形にする", () => {
    expect(buildVoteUrl("https://a.vercel.app/", "abc123")).toBe("https://a.vercel.app/v/abc123");
  });
  it("トークンは、URLに使える形にする(記号があっても、パスを壊さない)", () => {
    expect(buildVoteUrl("https://a.vercel.app", "a/b?c#d")).toBe("https://a.vercel.app/v/a%2Fb%3Fc%23d");
  });
  it("アドレスが読めない・トークンが空なら null", () => {
    expect(buildVoteUrl("nope", "abc")).toBeNull();
    expect(buildVoteUrl("https://a.vercel.app", "")).toBeNull();
  });
});

describe("isUnreachableBase(配っても開けないアドレスか)", () => {
  it("公開URL(https の vercel.app)は大丈夫", () => {
    expect(isUnreachableBase("https://seminar-vote.vercel.app")).toBe(false);
  });
  it.each([
    "http://localhost:3000", "https://localhost", "http://127.0.0.1:3111", "http://192.168.0.9:3111",
    "http://10.0.0.5", "http://172.16.1.1", "https://mypc.local", "http://seminar-vote.vercel.app", "garbage",
  ])("%s は、ほかの人のスマホからは開けない", (base) => {
    expect(isUnreachableBase(base)).toBe(true);
  });
  it("172.15 や 172.32 は、社内LANの範囲ではない", () => {
    expect(isUnreachableBase("https://172.15.0.1")).toBe(false);
    expect(isUnreachableBase("https://172.32.0.1")).toBe(false);
  });
});
