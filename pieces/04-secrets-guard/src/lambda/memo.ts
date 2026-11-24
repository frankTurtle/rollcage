/** Build a value on first use and keep it. */
export const lazy = <T>(build: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= build());
};

/**
 * Remember a successful async result for the life of the execution environment. A failure is not
 * remembered, so one throttled call does not break every later request in a warm environment.
 */
export const remember = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
};
