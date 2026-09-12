export function advanceRotation(current, events) {
  if (!events.length) return { kind: "calendar", index: -1 };
  if (current.kind === "event") return { kind: "calendar", index: current.index };
  return { kind: "event", index: (current.index + 1) % events.length };
}

export function reconcileRotation(current, previous, next) {
  if (!next.length) return { kind: "calendar", index: -1 };
  if (!previous.length) return { kind: current.kind, index: current.kind === "event" ? 0 : -1 };
  const currentId = previous[current.index]?.id;
  const index = currentId == null ? -1 : next.findIndex((item) => item.id === currentId);
  if (index >= 0) return { kind: current.kind, index };
  // If the visible event disappeared, show the calendar before its successor.
  return { kind: "calendar", index: Math.min(current.index - 1, next.length - 1) };
}
