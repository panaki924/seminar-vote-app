// QRコードに入れる投票URLの組み立て(純粋関数)。
// 先頭の部分(公開URL)は、QR画面を開いたアドレスから決める。手で直すこともできる。

/** 入力を、http(s) のアドレスの「先頭の部分(https://ホスト名)」だけにそろえる。読み取れなければ null。 */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** 投票画面のURL。トークンは、URLに使える形にして付ける。 */
export function buildVoteUrl(base: string, token: string): string | null {
  const origin = normalizeBaseUrl(base);
  if (!origin || token.length === 0) return null;
  return `${origin}/v/${encodeURIComponent(token)}`;
}

/** 配っても、他の人のスマホからは開けないアドレス(自分のパソコンの中・社内LAN・http)か。 */
export function isUnreachableBase(base: string): boolean {
  const origin = normalizeBaseUrl(base);
  if (!origin) return true;
  const url = new URL(origin);
  const host = url.hostname;
  return (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
