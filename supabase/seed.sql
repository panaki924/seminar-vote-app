-- ============================================================
-- seed.sql : 初期データ(名簿・動画・アプリ状態)を入れる
-- 実行場所 : Supabase の SQL Editor(schema.sql の実行後に1回だけ)
--
-- 名簿を差し替えたいときは、下の「名簿」の VALUES の行だけを書き換える。
--   ・動画の行(videos)は、名簿から自動で作られる。
--   ・トークンは書かない。DBが行を作るときに自動で生成する。
--   ・放映順は id(学籍番号)の並び順になる。
-- すでに名簿が入っている状態で再実行すると、重複エラーで全部取り消される(安全)。
-- ============================================================

begin;

-- 名簿(ここだけを書き換えればよい)
insert into members (id, name, name_en) values
  ('K0001', '織田信長',     'Oda Nobunaga'),
  ('K0002', '豊臣秀吉',     'Toyotomi Hideyoshi'),
  ('K0003', '徳川家康',     'Tokugawa Ieyasu'),
  ('K0004', '伊達政宗',     'Date Masamune'),
  ('K0005', '武田信玄',     'Takeda Shingen'),
  ('K0006', '上杉謙信',     'Uesugi Kenshin'),
  ('K0007', '毛利元就',     'Mori Motonari'),
  ('K0008', '長曾我部元親', 'Chosokabe Motochika'),
  ('K0009', '島津義弘',     'Shimazu Yoshihiro'),
  ('S001',  '豊臣秀長',     'Toyotomi Hidenaga');

-- 名簿の全員ぶんの動画を「未放映(pending)」で作る(status は初期値のまま)
insert into videos (member_id)
select id from members;

-- アプリ状態を1行作る(発表段階 0 = 何も見せない)
insert into app_state (id, reveal_stage) values (1, 0);

commit;

-- 確認用の表示(トークンの値そのものは出さない。長さだけ見る)
select
  (select count(*) from members)                   as members,           -- 名簿の人数(10になる)
  (select count(*) from videos)                    as videos,            -- 動画の数(10になる)
  (select min(char_length(token)) from members)    as min_token_length,  -- トークンの最短の長さ(64になる)
  (select reveal_stage from app_state where id = 1) as reveal_stage;     -- 発表段階(0になる)
