-- ============================================================
-- precheck.sql : schema.sql を実行する「前」の確認(読み取り専用)
-- 実行場所 : Supabase の SQL Editor
--
-- このファイルは select(見るだけ)の1本だけで、データも設定も一切変更しない。
-- 結果は1つの表にまとめて出る。次の3点を目で確認する。
--   (1) 'seminar_vote の状態' の行が「未使用(OK)」になっている
--       → 「すでに存在する」と出たら、schema.sql を実行してはいけない(中身を確認してから相談)。
--   (2) 'schema' の行に、既存のスキーマ名が並ぶ(seminar_vote が無いこと)
--   (3) 'public のテーブル' の行に、既存アプリのテーブルが並ぶ
--       → これらには schema.sql は触れない。
--       'public に同名あり' の行は参考表示。同じ名前があっても、別のスキーマに作るので衝突しない。
--   'ロール' の行に anon / authenticated / service_role の3つが出ていれば、権限の設定に必要な役割がそろっている。
-- ============================================================

select kind, name
from (
  -- システム用を除く、スキーマ名の一覧
  select 'schema' as kind, nspname::text as name
    from pg_namespace
    where nspname not like 'pg\_%' and nspname <> 'information_schema'

  union all

  -- public スキーマにあるテーブル名の一覧(既存アプリのもの)
  select 'public のテーブル', tablename::text
    from pg_tables
    where schemaname = 'public'

  union all

  -- seminar_vote という名前がすでに使われていないか
  select 'seminar_vote の状態',
         case when exists (select 1 from pg_namespace where nspname = 'seminar_vote')
              then '【注意】すでに存在する → schema.sql を実行しない'
              else '未使用(OK)'
         end

  union all

  -- 私たちが作る4つのテーブルと同じ名前が public にあるか(あっても衝突はしない。参考表示)
  select 'public に同名あり(参考・衝突はしない)', tablename::text
    from pg_tables
    where schemaname = 'public'
      and tablename in ('members', 'videos', 'votes', 'app_state')

  union all

  -- 権限の設定に使う3つの役割があるか
  select 'ロール', rolname::text
    from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
) as t
order by kind, name;
