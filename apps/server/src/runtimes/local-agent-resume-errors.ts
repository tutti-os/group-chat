export function isRecoverableResumeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /thread\/resume|resume failed|no rollout found|session.*not found|conversation.*not found/i.test(message)
    || /codex ran out of room in the model's context window/i.test(message)
  );
}
