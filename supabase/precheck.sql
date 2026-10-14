-- ============================================================
-- precheck.sql : schema.sql を実行する「前」の確認(読み取り専用)
-- 実行場所 : Supabase の SQL Editor
--
-- このファイルは select(見るだけ)の1本だけで、データも設定も一切変更しない。
-- 見るのは次の2点だけ。public など、seminar_vote 以外のスキーマの中身は読まない。
--   (1) 'seminar_vote の状態' の行が「未使用(OK)」になっている
--       → 「すでに存在する」と出たら、schema.sql を実行してはいけない(中身を確認してから相談)。
--   (2) 'ロール' の行に anon / authenticated / service_role の3つが出ている
--       → 権限の設定に必要な役割がそろっている。
-- ============================================================

-- seminar_vote という名前のスキーマがすでに使われていないか
select 'seminar_vote の状態' as kind,
       case when exists (select 1 from pg_namespace where nspname = 'seminar_vote')
            then '【注意】すでに存在する → schema.sql を実行しない'
            else '未使用(OK)'
       end as name

union all

-- 権限の設定に使う3つの役割があるか
select 'ロール', rolname::text
  from pg_roles
  where rolname in ('anon', 'authenticated', 'service_role')

order by kind, name;
