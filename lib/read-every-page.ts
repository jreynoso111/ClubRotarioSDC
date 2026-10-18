// Reads every row of a query in fixed-size pages, so a list never stops at an arbitrary limit.
// The query must order by a unique column; otherwise rows can move between pages and be missed.
export async function readEveryPage<T, E = unknown>(
  query: (first: number, last: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
  pageSize = 200,
): Promise<{ data: T[]; error: E | null }> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await query(offset, offset + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
