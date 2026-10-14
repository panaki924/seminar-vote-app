import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 本物の Supabase には接続しない。createClient を偽物に差し替えて、「どう呼ばれたか」だけを確かめる。
const createClient = vi.fn(() => ({ fake: true }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

// テスト専用のダミー値(本物のキーではない)
const DUMMY_URL = "https://dummy-project.example.invalid";
const DUMMY_KEY = "sb_secret_dummy_for_unit_test";

async function load() {
  vi.resetModules(); // 毎回、読み込み直して、保存済みの接続をリセットする
  return await import("./supabase");
}

describe("getSupabase", () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv("SUPABASE_URL", DUMMY_URL);
    vi.stubEnv("SUPABASE_SECRET_KEY", DUMMY_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("スキーマを seminar_vote に固定し、ログイン状態を保存しない設定で接続を作る", async () => {
    const { getSupabase } = await load();
    getSupabase();
    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(url).toBe(DUMMY_URL);
    expect(key).toBe(DUMMY_KEY);
    expect(options.db).toEqual({ schema: "seminar_vote" });
    expect(options.auth).toMatchObject({ persistSession: false });
  });

  it("2回目以降は同じ接続を使い回す(作り直さない)", async () => {
    const { getSupabase } = await load();
    expect(getSupabase()).toBe(getSupabase());
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("SUPABASE_URL が無いときは、変数名を示すエラーにする", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const { getSupabase } = await load();
    expect(() => getSupabase()).toThrow(/SUPABASE_URL/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("SUPABASE_SECRET_KEY が無いときは、変数名を示すエラーにする", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "   ");
    const { getSupabase } = await load();
    expect(() => getSupabase()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("エラーメッセージに、環境変数の値(URL・キー)は含まれない", async () => {
    const messageOf = async (): Promise<string> => {
      const { getSupabase } = await load();
      try {
        getSupabase();
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("エラーになるはずが、ならなかった");
    };

    vi.stubEnv("SUPABASE_URL", "not-a-url-value-xyz");
    expect(await messageOf()).not.toContain("not-a-url-value-xyz");

    vi.stubEnv("SUPABASE_URL", DUMMY_URL);
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_value_xyz");
    expect(await messageOf()).not.toContain("value_xyz");
  });

  it("URL が https:// などで始まらないときはエラーにする", async () => {
    vi.stubEnv("SUPABASE_URL", "not-a-url");
    const { getSupabase } = await load();
    expect(() => getSupabase()).toThrow(/https/);
  });

  it("公開用(publishable)キーが入っていたらエラーにする", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_publishable_dummy");
    const { getSupabase } = await load();
    expect(() => getSupabase()).toThrow(/publishable/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("ブラウザ(window がある環境)から呼ぶとエラーにする", async () => {
    vi.stubGlobal("window", {});
    try {
      const { getSupabase } = await load();
      expect(() => getSupabase()).toThrow(/サーバー専用/);
      expect(createClient).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
