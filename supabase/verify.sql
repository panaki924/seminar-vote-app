-- ============================================================
-- verify.sql : 不正なデータが DB に弾かれるかを確かめる(seminar_vote スキーマ)
-- 実行場所 : Supabase の SQL Editor(schema.sql の実行後。seed.sql の前でも後でもよい)
--
-- しくみ
--   ・begin ... rollback で全体を囲む。検証用データは最後にすべて取り消され、何も残らない。
--   ・各テストは「わざと不正なデータを入れる」。弾かれれば NOTICE に OK と出る。
--     弾かれずに入ってしまったら 'NG: ...' というエラーでスクリプトが止まる(= 不合格)。
--   ・赤いエラーが出ずに最後の表まで届き、検証データの残りが 0 なら合格。
--   ・NOTICE(OK の行)が画面に出ない場合があるが、エラーが出なければ全テスト合格と同じ意味になる。
-- 【注意】NG などのエラーで止まったら、まず「rollback;」だけを1行実行して状態をリセットする
-- すべて seminar_vote. を付けた名前で書く(public スキーマには触れない)。
-- ============================================================

begin;

-- 検証中だけ、すでに「投票中」の動画があれば閉じておく(rollback で元に戻る)
update seminar_vote.videos set status = 'closed' where status = 'open';

-- 検証用の参加者と動画を作る(本物の名簿とぶつからない VERIFY_ で始まるID)
insert into seminar_vote.members (id, name, name_en) values
  ('VERIFY_A', '検証A', 'Verify A'),
  ('VERIFY_B', '検証B', 'Verify B'),
  ('VERIFY_C', '検証C', 'Verify C');
insert into seminar_vote.videos (member_id) values ('VERIFY_A'), ('VERIFY_B'), ('VERIFY_C');

-- テスト1:【正常】ふつうの投票は入る(これが入らないと、他のテストの意味がなくなる)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_A', 'VERIFY_B', 3, 4);
  raise notice 'OK: 正常な投票は入る';
end $$;

-- テスト2:自己投票は弾かれる(CHECK制約 voter_id <> target_id)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_C', 'VERIFY_C', 3, 3);
  raise exception 'NG: 自己投票が入ってしまった';
exception
  when check_violation then raise notice 'OK: 自己投票は弾かれた';
end $$;

-- テスト3:技術点が6は弾かれる(CHECK制約 1〜5)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_C', 'VERIFY_A', 6, 3);
  raise exception 'NG: 技術点6が入ってしまった';
exception
  when check_violation then raise notice 'OK: 技術点6は弾かれた';
end $$;

-- テスト4:インパクト点が0は弾かれる(CHECK制約 1〜5)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_C', 'VERIFY_A', 3, 0);
  raise exception 'NG: インパクト点0が入ってしまった';
exception
  when check_violation then raise notice 'OK: インパクト点0は弾かれた';
end $$;

-- テスト5:同じ人が同じ動画に2回目の行を入れるのは弾かれる(主キー。再投票は上書きで行う)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_A', 'VERIFY_B', 5, 5);
  raise exception 'NG: 同じ(投票者, 対象)の2行目が入ってしまった';
exception
  when unique_violation then raise notice 'OK: 同じ組み合わせの重複行は弾かれた';
end $$;

-- テスト6:存在しない動画への投票は弾かれる(外部キー)
do $$
begin
  insert into seminar_vote.votes (voter_id, target_id, tech, impact) values ('VERIFY_A', 'NOBODY', 3, 3);
  raise exception 'NG: 存在しない動画への投票が入ってしまった';
exception
  when foreign_key_violation then raise notice 'OK: 存在しない動画への投票は弾かれた';
end $$;

-- テスト7:open は1本目は成功し、2本目は弾かれる(部分ユニークインデックス)
do $$
begin
  update seminar_vote.videos set status = 'open' where member_id = 'VERIFY_A';
  raise notice 'OK: open の1本目は成功した';
end $$;
do $$
begin
  update seminar_vote.videos set status = 'open' where member_id = 'VERIFY_B';
  raise exception 'NG: open が2本になってしまった';
exception
  when unique_violation then raise notice 'OK: open の2本目は弾かれた';
end $$;

-- テスト8:status に決まった4種類以外の値は弾かれる(CHECK制約)
do $$
begin
  update seminar_vote.videos set status = 'foo' where member_id = 'VERIFY_C';
  raise exception 'NG: 不正な status が入ってしまった';
exception
  when check_violation then raise notice 'OK: 不正な status は弾かれた';
end $$;

-- テスト9:reveal_stage が4は弾かれる(CHECK制約 0〜3)
do $$
begin
  insert into seminar_vote.app_state (id, reveal_stage) values (1, 4)
    on conflict (id) do update set reveal_stage = excluded.reveal_stage;
  raise exception 'NG: reveal_stage 4 が入ってしまった';
exception
  when check_violation then raise notice 'OK: reveal_stage 4 は弾かれた';
end $$;

-- テスト10:app_state は id=1 以外の行を作れない(CHECK制約。行は最大1つ)
do $$
begin
  insert into seminar_vote.app_state (id, reveal_stage) values (2, 0);
  raise exception 'NG: app_state の2行目が入ってしまった';
exception
  when check_violation then raise notice 'OK: app_state の2行目は弾かれた';
end $$;

-- テスト11:トークンは自動で64文字・全員別々に作られる(検証用の3人で確認)
do $$
declare
  min_len int;
  kinds   int;
begin
  select min(char_length(token)), count(distinct token)
    into min_len, kinds
    from seminar_vote.members where id like 'VERIFY\_%';
  if min_len = 64 and kinds = 3 then
    raise notice 'OK: トークンは自動で64文字、全員別の値になった';
  else
    raise exception 'NG: トークンが不正(最短の長さ=%、種類=%)', min_len, kinds;
  end if;
end $$;

-- テスト12:短いトークンを手で入れると弾かれる(CHECK制約 32文字以上)
do $$
begin
  insert into seminar_vote.members (id, name, name_en, token) values ('VERIFY_D', '検証D', 'Verify D', 'short');
  raise exception 'NG: 短いトークンが入ってしまった';
exception
  when check_violation then raise notice 'OK: 短いトークンは弾かれた';
end $$;

-- テスト13:seminar_vote の4テーブルすべてでRLSが有効で、ポリシーが1つも無い
do $$
declare
  rls_on   int;
  policies int;
begin
  select count(*) into rls_on
    from pg_class
    where relnamespace = 'seminar_vote'::regnamespace
      and relname in ('members', 'videos', 'votes', 'app_state')
      and relrowsecurity;
  select count(*) into policies
    from pg_policies
    where schemaname = 'seminar_vote';
  if rls_on = 4 and policies = 0 then
    raise notice 'OK: 4テーブルともRLS有効、ポリシーなし';
  else
    raise exception 'NG: RLS有効=%個(4が正)、ポリシー=%個(0が正)', rls_on, policies;
  end if;
end $$;

-- テスト14:公開キー相当(anon)とログイン利用者(authenticated)では、名簿が読めない
do $$
declare
  r text;
  n int;
begin
  foreach r in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', r);
      execute 'select count(*) from seminar_vote.members' into n;
      reset role;
      if n = 0 then
        raise notice 'OK: % からは0件しか見えない', r;
      else
        raise exception 'NG: % に名簿が%件見えてしまった', r, n;
      end if;
    exception
      when insufficient_privilege then
        reset role;
        raise notice 'OK: % は権限エラーで弾かれた', r;
    end;
  end loop;
end $$;

-- テスト15:権限は service_role にだけ渡されている(anon / authenticated / 全員 には何も無い)
do $$
declare
  r    text;
  t    text;
  p    text;
  bad  int := 0;
  miss int := 0;
begin
  -- (a) anon と authenticated には、スキーマにも4テーブルにも権限が無い
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'seminar_vote', 'usage') then bad := bad + 1; end if;
    foreach t in array array['members', 'videos', 'votes', 'app_state'] loop
      if has_table_privilege(r, 'seminar_vote.' || t, 'select,insert,update,delete,truncate,references,trigger') then
        bad := bad + 1;
      end if;
    end loop;
  end loop;
  -- (b) 「全員(PUBLIC)」宛ての権限が、スキーマにも4テーブルにも無い
  select bad + count(*) into bad
    from pg_namespace n, aclexplode(n.nspacl) a
    where n.nspname = 'seminar_vote' and a.grantee = 0;
  select bad + count(*) into bad
    from pg_class c, aclexplode(c.relacl) a
    where c.relnamespace = 'seminar_vote'::regnamespace and a.grantee = 0;
  -- (c) service_role には、必要な権限がそろっている
  if not has_schema_privilege('service_role', 'seminar_vote', 'usage') then miss := miss + 1; end if;
  foreach t in array array['members', 'videos', 'votes', 'app_state'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if not has_table_privilege('service_role', 'seminar_vote.' || t, p) then miss := miss + 1; end if;
    end loop;
  end loop;
  if bad = 0 and miss = 0 then
    raise notice 'OK: 権限は service_role にだけ渡されている';
  else
    raise exception 'NG: 余計な権限=%件(0が正)、足りない権限=%件(0が正)', bad, miss;
  end if;
end $$;

-- テスト16:【正常】service_role はRLSを越えて、名簿を読める(サーバーから使えることの確認)
do $$
declare
  n int;
begin
  set local role service_role;
  select count(*) into n from seminar_vote.members where id like 'VERIFY\_%';
  reset role;
  if n = 3 then
    raise notice 'OK: service_role は名簿を読める';
  else
    raise exception 'NG: service_role から検証用の名簿が%件しか見えない(3が正)', n;
  end if;
end $$;

-- ここまでの検証データ(VERIFY_ のID、検証用の投票、status・app_state の変更)を全部取り消す
rollback;

-- 後始末の確認(最後の文の結果が画面に出る)
select
  (select count(*) from seminar_vote.members where id like 'VERIFY\_%') as verify_leftover,  -- 0 なら検証データは残っていない
  (select count(*) from seminar_vote.members)                           as members,          -- seed 後は10、前は0
  (select count(*) from seminar_vote.votes)                             as votes,            -- 0 のまま
  (select count(*) from seminar_vote.videos where status = 'open')      as open_videos;      -- 実行前と同じ(通常は0)
