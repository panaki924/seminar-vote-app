-- ============================================================
-- schema.sql : テーブル・制約・鍵(RLS)を作る
-- 実行場所 : Supabase の SQL Editor(空のデータベースに1回だけ実行する)
-- 途中で失敗したら全部やり直しになる(begin ... commit で囲んでいるため)
-- ============================================================

begin;  -- ここから commit までを「全部成功か、全部なかったことか」の1かたまりにする

-- ------------------------------------------------------------
-- members : 参加者の名簿
-- ------------------------------------------------------------
create table members (
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
create table videos (
  member_id text primary key    -- 動画の持ち主。members の誰か1人に対応する
    references members (id) on delete cascade,  -- 名簿に居ない人は不可。名簿から消えたら動画も消える
  status text not null default 'pending'        -- 最初は「未放映」
    check (status in ('pending', 'open', 'closed', 'not_shown'))  -- この4つ以外は拒否
);

-- 「open(投票中)は同時に1本だけ」を守る部分ユニークインデックス。
-- status='open' の行だけを対象に、(true) という全員共通の値の重複を禁止する。
-- つまり open の行は2本目を入れようとすると必ずエラーになる。
create unique index videos_only_one_open
  on videos ((true))
  where status = 'open';

-- ------------------------------------------------------------
-- votes : 投票(誰が・どの動画に・何点つけたか)
-- ------------------------------------------------------------
create table votes (
  voter_id  text not null references members (id) on delete cascade,    -- 投票した人
  target_id text not null references videos (member_id) on delete cascade,  -- 投票された動画の持ち主
  tech      smallint not null check (tech   between 1 and 5),  -- 技術点。1〜5の整数だけ
  impact    smallint not null check (impact between 1 and 5),  -- インパクト点。1〜5の整数だけ
  updated_at timestamptz not null default now(),  -- 最後に送信した日時(再投票で更新する)
  primary key (voter_id, target_id),  -- 同じ人が同じ動画に2行は入れられない(再投票は上書き)
  check (voter_id <> target_id)       -- 自分の動画への投票は不可(自己投票の防止)
);

-- ------------------------------------------------------------
-- app_state : アプリ全体の状態(1行だけ)
-- ------------------------------------------------------------
create table app_state (
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
alter table members   enable row level security;
alter table videos    enable row level security;
alter table votes     enable row level security;
alter table app_state enable row level security;

-- 念のための二重鍵:公開キー系の役割(anon / authenticated)から、権限そのものを取り上げる。
-- RLSだけでも守られるが、設定ミスがあっても読み書きできないようにする。
revoke all on members, videos, votes, app_state from anon, authenticated;

commit;
