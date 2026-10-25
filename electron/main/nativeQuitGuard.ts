/** Unknown execution requires the same explicit decision as active execution. */
export async function confirmNativeQuit({
  lookup,
  confirm,
}: {
  lookup: () => Promise<unknown>;
  confirm: (unknown: boolean) => Promise<boolean>;
}): Promise<boolean> {
  let active: boolean | undefined;
  try {
    const response = await lookup();
    const value = (response as { active?: unknown } | null)?.active;
    if (typeof value === 'boolean') active = value;
  } catch {
    // The dialog explains that the running-task state could not be checked.
  }
  if (active === false) return true;
  return confirm(active === undefined);
}
