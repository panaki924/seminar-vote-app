-- ============================================================
-- schema.sql : 専用スキーマ seminar_vote の中に、テーブル・制約・鍵(RLS)を作る
-- 実行場所 : Supabase の SQL Editor(事前に precheck.sql で確認してから、1回だけ実行する)
-- 途中で失敗したら全部やり直しになる(begin ... commit で囲んでいるため)
-- 【注意】エラーで止まったら、まず「rollback;」だけを1行実行して状態をリセットし、原因を直してから再実行する
--
-- 【既存のデータを守るルール】
--   ・作るものは、すべて seminar_vote. を付けた名前で作る(別のアプリの public スキーマには触れない)。
--   ・「public のテーブル全部」のような広い範囲を指定する文は1つも使わない。
--   ・権限の変更(revoke / grant)は、seminar_vote のスキーマ名とテーブル名を1つずつ書いて指定する。
-- ============================================================

begin;  -- ここから commit までを「全部成功か、全部なかったことか」の1かたまりにする

-- ------------------------------------------------------------
-- 専用スキーマ(テーブルを入れる「専用の引き出し」)を作る
-- すでに seminar_vote があるとエラーで止まる(別のものを上書きしないための安全装置)
-- ------------------------------------------------------------
create schema seminar_vote;

-- ------------------------------------------------------------
-- members : 参加者の名簿
-- ------------------------------------------------------------
create table seminar_vote.members (
  id      text primary key,   -- 学籍番号(例: K0001)。1人に1つで、重複は不可
  name    text not null,      -- 氏名(日本語)
  name_en text not null,      -- 氏名(英字)
  token   text not null unique  -- 本人確認用のランダム文字列。重複は不可
    -- 初期値は「UUIDを2つつなげてハイフンを除いた64文字」。
    -- gen_random_uuid() は安全な乱数で作られるので、推測できない。
    -- 値はこのファイルに書かれず、行が作られた瞬間にDBが生成する。
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    -- 手で短いトークンを入れてしまう事故を防ぐ(32文字未満は拒否)
    check (char_length(token) >= 32)
);

-- ------------------------------------------------------------
-- videos : 動画ごとの状態(1人に1本)
-- ------------------------------------------------------------
create table seminar_vote.videos (
  member_id text primary key    -- 動画の持ち主。members の誰か1人に対応する
    references seminar_vote.members (id) on delete cascade,  -- 名簿に居ない人は不可。名簿から消えたら動画も消える
  status text not null default 'pending'        -- 最初は「未放映」
    check (status in ('pending', 'open', 'closed', 'not_shown'))  -- この4つ以外は拒否
);

-- 「open(投票中)は同時に1本だけ」を守る部分ユニークインデックス。
-- status='open' の行だけを対象に、(true) という全員共通の値の重複を禁止する。
-- つまり open の行は2本目を入れようとすると必ずエラーになる。
create unique index videos_only_one_open
  on seminar_vote.videos ((true))
  where status = 'open';

-- ------------------------------------------------------------
-- votes : 投票(誰が・どの動画に・何点つけたか)
-- ------------------------------------------------------------
create table seminar_vote.votes (
  voter_id  text not null references seminar_vote.members (id) on delete cascade,        -- 投票した人
  target_id text not null references seminar_vote.videos (member_id) on delete cascade,  -- 投票された動画の持ち主
  tech      smallint not null check (tech   between 1 and 5),  -- 技術点。1〜5の整数だけ
  impact    smallint not null check (impact between 1 and 5),  -- インパクト点。1〜5の整数だけ
  updated_at timestamptz not null default now(),  -- 最後に送信した日時(再投票で更新する)
  primary key (voter_id, target_id),  -- 同じ人が同じ動画に2行は入れられない(再投票は上書き)
  check (voter_id <> target_id)       -- 自分の動画への投票は不可(自己投票の防止)
);

-- ------------------------------------------------------------
-- app_state : アプリ全体の状態(1行だけ)
-- ------------------------------------------------------------
create table seminar_vote.app_state (
  id smallint primary key default 1
    check (id = 1),                   -- id は 1 だけ許す = 行は最大1つ
  reveal_stage smallint not null default 0
    check (reveal_stage between 0 and 3)  -- 0=非表示 1=3位 2=2位まで 3=1位まで
);

-- ------------------------------------------------------------
-- RLS(行レベルセキュリティ)を有効にする
-- ポリシー(許可ルール)は1つも作らない。
-- → 公開キー(anon)ではどのテーブルも読み書きできない状態になる。
-- → サーバー側の service_role キーはRLSの対象外なので、これまでどおり使える。
-- ------------------------------------------------------------
alter table seminar_vote.members   enable row level security;
alter table seminar_vote.videos    enable row level security;
alter table seminar_vote.votes     enable row level security;
alter table seminar_vote.app_state enable row level security;

-- ------------------------------------------------------------
-- 権限(鍵の持ち主)を整える。seminar_vote のものだけを、名前を1つずつ指定して扱う。
-- ------------------------------------------------------------
-- (1) まず、誰にも渡さない状態にそろえる(public は「全員」を表す特別な名前。スキーマの public とは別物)
revoke all on schema seminar_vote from public, anon, authenticated;
revoke all on seminar_vote.members   from public, anon, authenticated;
revoke all on seminar_vote.videos    from public, anon, authenticated;
revoke all on seminar_vote.votes     from public, anon, authenticated;
revoke all on seminar_vote.app_state from public, anon, authenticated;

-- (2) サーバー専用の service_role にだけ、必要な権限を渡す
grant usage on schema seminar_vote to service_role;  -- スキーマの中に入ってよい
grant select, insert, update, delete                 -- 読む・追加・更新・削除だけ(それ以上は渡さない)
  on seminar_vote.members, seminar_vote.videos, seminar_vote.votes, seminar_vote.app_state
  to service_role;

commit;
