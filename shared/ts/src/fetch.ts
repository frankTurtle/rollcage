/** The subset of fetch the library needs, so tests can inject a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
