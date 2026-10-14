// 接続テスト(読み取りだけ)。seminar_vote.members の件数を数えるだけで、何も書き込まない。
// 実行:npm run check:db   (.env.local を読み込んで実行される)
// 成功の目安:「members の件数: 10」と出る。キーやURLの値は表示しない。
import { DB_SCHEMA, getSupabase } from "../lib/supabase.ts";

const EXPECTED = 10;

async function main() {
  const supabase = getSupabase();

  // head: true = 中身は取らず、件数だけを数える(トークンなどは読まない)
  const { count, error, status } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error(`接続テスト失敗(スキーマ: ${DB_SCHEMA}, HTTP ${status})`);
    console.error(`  コード: ${error.code || "(なし)"}`);
    console.error(`  メッセージ: ${error.message || "(なし)"}`);
    if (error.hint) console.error(`  ヒント: ${error.hint}`);
    process.exitCode = 1;
    return;
  }

  console.log(`members の件数: ${count}`);
  if (count === EXPECTED) {
    console.log(`成功:想定どおり ${EXPECTED} 件でした。`);
  } else {
    console.error(`想定(${EXPECTED} 件)と違います。seed.sql が実行済みか確認してください。`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  // 環境変数の不足など。メッセージには値が含まれない作りになっている
  console.error("接続テスト失敗:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
