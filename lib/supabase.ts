// サーバー専用の Supabase 接続部品。
// ・秘密キー(SUPABASE_SECRET_KEY)を使うので、ブラウザ側のコードから読み込んではいけない。
// ・どのテーブルも、専用スキーマ seminar_vote の中のものとして扱う(public には触れない)。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DB_SCHEMA = "seminar_vote";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SeminarVoteClient = SupabaseClient<any, typeof DB_SCHEMA>;

// 環境変数を読む。無いときは、何を直せばよいかが分かるエラーにする(値は表示しない)。
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。` +
        `プロジェクト直下の .env.local に「${name}=(値)」の形で1行書き、` +
        `開発サーバーを再起動してください。(値はここには表示されません)`,
    );
  }
  return value;
}

let cached: SeminarVoteClient | undefined;

// 接続を返す。最初に呼ばれたときに1回だけ作る。
// import しただけでは作らない(環境変数が無くてもビルドや型チェックが通るように)。
export function getSupabase(): SeminarVoteClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase.ts はサーバー専用です。ブラウザで動くコード(画面側)から読み込まず、" +
        "app/api の Route Handler から呼んでください。",
    );
  }
  if (cached) return cached;

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SECRET_KEY");

  if (!/^https?:\/\//.test(url)) {
    throw new Error("環境変数 SUPABASE_URL は https:// で始まる URL にしてください。");
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "環境変数 SUPABASE_SECRET_KEY に「publishable(公開用)」のキーが入っています。" +
        "サーバー専用の secret(sb_secret_ で始まる)キーを入れてください。",
    );
  }

  cached = createClient<any, typeof DB_SCHEMA>(url, key, { // eslint-disable-line @typescript-eslint/no-explicit-any
    db: { schema: DB_SCHEMA }, // 何も指定しなくても seminar_vote のテーブルを使う
    auth: {
      persistSession: false, // サーバー側では、ログイン状態を保存しない
      autoRefreshToken: false, // ログイン用の定期更新も使わない(キーだけで動かす)
    },
  });
  return cached;
}
